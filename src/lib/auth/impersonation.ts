import "server-only";
import { cache } from "react";
import { createHmac, timingSafeEqual } from "crypto";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth/guards";
import { ROLES } from "@/lib/constants";
import { SESSION_COOKIE_NAME, IMPERSONATION_COOKIE_NAME } from "@/lib/auth/session-constants";
import type { SessionUser } from "@/lib/auth/session";

/** How long a signed impersonation token stays valid, enforced from its own
 * embedded (signed, tamper-proof) `issuedAt` — deliberately much shorter
 * than SESSION_TTL_MS (30 days). Impersonation is a sensitive, elevated-
 * privilege action; requiring it to be re-established periodically (rather
 * than silently riding along for as long as the admin happens to stay
 * logged in) is a deliberate choice, not an oversight — "at minimum, do not
 * create an unnecessarily long-lived persistent impersonation cookie". The
 * token is ALSO cryptographically bound to the admin's current session (see
 * signImpersonationToken below), so in practice it dies immediately on
 * logout/login regardless of this TTL — this bound is the belt-and-
 * suspenders cap for the case the admin stays logged into the same session
 * for a long time. */
const IMPERSONATION_TOKEN_TTL_MS = 1000 * 60 * 60 * 8; // 8 hours

const IMPERSONATION_COOKIE_OPTIONS = {
  httpOnly: true,
  sameSite: "lax" as const,
  secure: process.env.NODE_ENV === "production",
  path: "/",
};

const REP_SCOPE_SELECT = {
  id: true,
  userId: true,
  isActive: true,
  carStockLocation: { select: { id: true } },
  user: { select: { name: true, isActive: true } },
} as const;

export interface EffectiveRepresentative {
  /** SalesRepresentative.id — the effective scope for this request. Use
   * this, never a client-supplied repId, for every REP-scoped read/write
   * (Order.createdByRepId, StockRequest.salesRepId, merchant-assignment
   * filters, etc.). */
  repId: string;
  /** The rep's OWN persisted User.id — the id every business write must be
   * stamped with (AccountPayment.createdById, StockMovement.createdById,
   * Order's own actor-facing fields) so ownership/reporting always
   * reflects the real representative, exactly as if they performed the
   * action themselves, regardless of who is actually driving the browser. */
  actingUserId: string;
  carStockLocationId: string | null;
  repName: string;
  /** The REAL authenticated session — always the actual signed-in user,
   * never swapped, never lost. Use this (never actingUserId) for anything
   * that must reflect who is truly at the keyboard — audit logging, the
   * impersonation banner, the "end impersonation" control. */
  realUser: SessionUser;
  /** True only when realUser.role === ADMIN and this scope came from an
   * active, signature-verified, DB-revalidated impersonation context —
   * never true for a real SALES_REPRESENTATIVE acting on their own
   * profile. */
  isImpersonating: boolean;
}

/** The signed impersonation token's own payload — never trusted merely
 * because it decodes successfully; only ever trusted after
 * verifyImpersonationToken's signature check passes (see below). */
interface ImpersonationPayload {
  /** The REAL admin's own User.id — bound into the signed payload itself
   * (never inferred from "whoever the cookie happens to belong to"), so a
   * different admin authenticating on the same browser can never inherit
   * this token even if the raw cookie bytes survive. */
  adminUserId: string;
  salesRepId: string;
  /** Epoch ms this token was issued — part of the SIGNED payload, so unlike
   * the cookie's own `expires` attribute (metadata the browser could fail
   * to honor, and which tampering with the cookie value doesn't touch),
   * this expiry cannot be extended or stripped without invalidating the
   * signature. */
  issuedAt: number;
}

/** Fixed domain-separation prefix mixed into every HMAC input — so this
 * signature can never be confused with, or replayed as, any other possible
 * future use of a session-id-keyed HMAC elsewhere in this app. */
const TOKEN_CONTEXT = "ovi-impersonation-v1";

/** Signs an impersonation payload using the ADMIN'S OWN CURRENT SESSION ID
 * as the HMAC key — see the design note on signImpersonationToken's sibling
 * verifyImpersonationToken for the full rationale. Node's built-in `crypto`
 * (already used by src/lib/auth/password.ts for scrypt hashing) is used
 * directly — no new dependency, no invented cipher. */
function signImpersonationToken(payload: ImpersonationPayload, sessionId: string): string {
  const payloadB64 = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
  const signature = createHmac("sha256", sessionId).update(`${TOKEN_CONTEXT}:${payloadB64}`).digest("base64url");
  return `${payloadB64}.${signature}`;
}

/** Verifies a signed impersonation token against the CALLER'S OWN CURRENT
 * session id, returning the decoded payload only if the signature matches,
 * the shape is valid, and it has not expired — returns null on any failure
 * (never throws), so every caller can treat "verification failed" and
 * "cookie absent" identically.
 *
 * DESIGN NOTE — why the admin's own live session id is the signing key,
 * with no new secret and no schema change:
 *
 * This codebase's session system (src/lib/auth/session.ts) has no general-
 * purpose signing/HMAC secret at all — sessions are opaque, unguessable,
 * DB-backed ids (`prisma.session.create()`), never signed tokens, and there
 * is no SESSION_SECRET/APP_SECRET env var anywhere in this project (only
 * integration-specific secrets — GOOGLE_CLIENT_SECRET, CLOUDINARY_API_SECRET
 * — which belong to unrelated third parties and must never be repurposed as
 * our own signing key). Per the explicit instruction to reuse an existing
 * primitive rather than invent one, and to add neither a new env var nor a
 * schema change: the one thing this app already treats as a secret, unique
 * per authenticated admin, freshly re-verified against the DB on every
 * request, and inherently invalidated by both logout and a fresh login, IS
 * that admin's own live session id (the exact value requireUser()/
 * getSession() already trust as sufficient to authenticate every single
 * request in this app). Deriving the impersonation token's HMAC key from it
 * gives, for free, with zero additional state:
 *   - Tamper-evidence: editing the payload (e.g. swapping salesRepId, or
 *     forging adminUserId) without knowing the admin's own session id
 *     invalidates the signature.
 *   - Automatic death on logout: destroySession() deletes the session row;
 *     the id a stale token was signed with no longer resolves to anything,
 *     and (belt-and-suspenders) the impersonation cookie is also explicitly
 *     cleared at that same moment (see clearImpersonationCookie's callers
 *     in session.ts).
 *   - Automatic death on a new login, including a DIFFERENT admin on the
 *     SAME browser: a fresh createSession() issues a brand-new session id,
 *     under which the old token's signature no longer verifies — again
 *     also explicitly cleared at that moment as a second, independent
 *     guarantee, not relied on alone.
 * This does not defend against an attacker who has already obtained the
 * admin's raw session id (that is already full account takeover under this
 * app's existing session model, with or without impersonation); it defends
 * exactly against the threats named for this feature: manual cookie
 * tampering, cross-login replay, and cross-admin replay on a shared
 * browser. */
function verifyImpersonationToken(token: string, sessionId: string): ImpersonationPayload | null {
  const parts = token.split(".");
  if (parts.length !== 2) return null;
  const [payloadB64, signature] = parts;
  if (!payloadB64 || !signature) return null;

  const expectedSignature = createHmac("sha256", sessionId).update(`${TOKEN_CONTEXT}:${payloadB64}`).digest("base64url");

  const signatureBuffer = Buffer.from(signature, "utf8");
  const expectedBuffer = Buffer.from(expectedSignature, "utf8");
  if (signatureBuffer.length !== expectedBuffer.length || !timingSafeEqual(signatureBuffer, expectedBuffer)) {
    return null;
  }

  let decoded: unknown;
  try {
    decoded = JSON.parse(Buffer.from(payloadB64, "base64url").toString("utf8"));
  } catch {
    return null;
  }

  if (
    !decoded ||
    typeof decoded !== "object" ||
    typeof (decoded as Record<string, unknown>).adminUserId !== "string" ||
    typeof (decoded as Record<string, unknown>).salesRepId !== "string" ||
    typeof (decoded as Record<string, unknown>).issuedAt !== "number"
  ) {
    return null;
  }

  const payload = decoded as ImpersonationPayload;
  if (Date.now() - payload.issuedAt > IMPERSONATION_TOKEN_TTL_MS || Date.now() < payload.issuedAt) {
    return null;
  }

  return payload;
}

/** THE canonical source of "which SalesRepresentative is this request
 * acting as." Every /rep page/layout and every REP server action must
 * resolve scope through this — never by calling requireRole([SALES_REPRESENTATIVE])
 * and separately re-deriving `prisma.salesRepresentative.findUnique({where:{userId}})`
 * inline, and never by reading the impersonation cookie directly.
 *
 * A) Real user is SALES_REPRESENTATIVE -> their own SalesRepresentative row
 *    (isActive required — a deactivated rep's own session is rejected the
 *    same way it always was before impersonation existed). The
 *    impersonation cookie, if one happens to be present (e.g. stale data
 *    from when this same browser was previously used by an admin), is
 *    never even consulted in this branch — a real rep's own identity can
 *    never be overridden by it.
 * B) Real user is ADMIN AND a valid, signature-verified impersonation token
 *    exists, bound to THIS admin's own id -> the selected SalesRepresentative
 *    row, re-validated FRESH from the DB on every single call (row still
 *    exists, isActive, linked User still exists and isActive). Any failure
 *    — bad/missing signature, expired, adminUserId mismatch, stale/deleted/
 *    deactivated target — is treated as no impersonation at all: the cookie
 *    is cleared server-side right here and the caller falls through to case
 *    C, never continuing to act as a stale or forged target.
 * C) Otherwise (including an ADMIN with no active impersonation, and every
 *    other role — ADMIN_ASSISTANT included) -> redirect. An ADMIN is sent
 *    to /admin/reps ("choose a representative first") rather than
 *    /dashboard, since that's the actionable next step for that specific
 *    case; every other role is sent to /dashboard, matching requireRole's
 *    own existing convention. /rep never silently acts as some default
 *    representative.
 *
 * Wrapped in React's cache() for per-request memoization — every /rep page
 * calls this independently (the same "each page has its own explicit
 * guard, redundant with the layout but visible on its own" convention
 * requireRole/getSession already use elsewhere in this app), so without
 * this every one of those would re-run the same session+DB lookup. */
export const requireEffectiveRepresentative = cache(async (): Promise<EffectiveRepresentative> => {
  const realUser = await requireUser();

  if (realUser.role === ROLES.SALES_REPRESENTATIVE) {
    const rep = await prisma.salesRepresentative.findUnique({
      where: { userId: realUser.id },
      select: REP_SCOPE_SELECT,
    });
    if (!rep || !rep.isActive) {
      redirect("/dashboard");
    }
    return {
      repId: rep.id,
      actingUserId: rep.userId,
      carStockLocationId: rep.carStockLocation?.id ?? null,
      repName: rep.user.name,
      realUser,
      isImpersonating: false,
    };
  }

  if (realUser.role === ROLES.ADMIN) {
    const cookieStore = await cookies();
    const token = cookieStore.get(IMPERSONATION_COOKIE_NAME)?.value;

    if (token) {
      const sessionId = cookieStore.get(SESSION_COOKIE_NAME)?.value;
      // sessionId is always present here — requireUser() above only
      // resolves realUser via getSession(), which requires this exact
      // cookie. Still checked defensively rather than asserted.
      const payload = sessionId ? verifyImpersonationToken(token, sessionId) : null;

      if (payload && payload.adminUserId === realUser.id) {
        const rep = await prisma.salesRepresentative.findUnique({
          where: { id: payload.salesRepId },
          select: REP_SCOPE_SELECT,
        });
        if (rep && rep.isActive && rep.user.isActive) {
          return {
            repId: rep.id,
            actingUserId: rep.userId,
            carStockLocationId: rep.carStockLocation?.id ?? null,
            repName: rep.user.name,
            realUser,
            isImpersonating: true,
          };
        }
      }
      // Any failure — bad signature, wrong admin, expired, or a stale/
      // invalid target — never keeps acting as it.
      cookieStore.delete(IMPERSONATION_COOKIE_NAME);
    }

    redirect("/admin/reps");
  }

  redirect("/dashboard");
});

/** Sets the impersonation cookie to a freshly signed token binding this
 * exact ADMIN to this exact SalesRepresentative.id. Callers must have
 * already verified: acting user is ROLES.ADMIN, and the target
 * SalesRepresentative exists with an active linked User — this function
 * itself does not re-check eligibility, it only performs the signed cookie
 * write (see startImpersonationAction in src/app/admin/reps/actions.ts for
 * the actual guarded entry point). Overwrites any previous impersonation
 * context outright — starting a new one always cleanly replaces the last,
 * never overlapping.
 *
 * Throws if no session cookie is present — defensive only; every real
 * caller runs behind requireRole([ROLES.ADMIN]) first, which guarantees
 * one. A raw rep id can never be written here on its own; a valid session
 * id to sign against is always required. */
export async function setImpersonationCookie(adminUserId: string, salesRepId: string): Promise<void> {
  const cookieStore = await cookies();
  const sessionId = cookieStore.get(SESSION_COOKIE_NAME)?.value;
  if (!sessionId) {
    throw new Error("Cannot start impersonation without an active admin session");
  }

  const token = signImpersonationToken({ adminUserId, salesRepId, issuedAt: Date.now() }, sessionId);
  cookieStore.set(IMPERSONATION_COOKIE_NAME, token, {
    ...IMPERSONATION_COOKIE_OPTIONS,
    expires: new Date(Date.now() + IMPERSONATION_TOKEN_TTL_MS),
  });
}

/** Clears the impersonation cookie — the sole effect of "ending"
 * impersonation. Never touches the real session/auth cookie, never signs
 * anyone out. Also called from src/lib/auth/session.ts's createSession()
 * and destroySession() (login/logout cleanup), so an impersonation cookie
 * can never silently survive a fresh login or outlive a logout — session.ts
 * deletes the cookie by its name directly (IMPERSONATION_COOKIE_NAME is
 * defined in session-constants.ts, not here, specifically so session.ts
 * never has to import this module — see that constant's own doc comment
 * for why). */
export async function clearImpersonationCookie(): Promise<void> {
  const cookieStore = await cookies();
  cookieStore.delete(IMPERSONATION_COOKIE_NAME);
}

/** Reads and FULLY VERIFIES the current impersonation token — signature,
 * expiry, and that it is bound to `adminUserId` — without re-checking the
 * target SalesRepresentative's current DB state. Used only by
 * endImpersonationAction, which needs to know which rep was being
 * impersonated (to log IMPERSONATION_ENDED accurately) before clearing the
 * cookie; deliberately does NOT re-validate the rep is still active, since
 * an admin must always be able to cleanly end impersonation of a rep who
 * became inactive mid-session. Returns null (never throws) for any missing/
 * unsigned/tampered/expired/cross-admin token — callers must treat that as
 * "nothing to log", never as "log with untrusted data". Never used to
 * authorize anything; authorization for actually USING an effective rep
 * scope always goes through requireEffectiveRepresentative's own fresh DB
 * re-check. */
export async function readValidatedImpersonationTarget(adminUserId: string): Promise<{ salesRepId: string } | null> {
  const cookieStore = await cookies();
  const token = cookieStore.get(IMPERSONATION_COOKIE_NAME)?.value;
  if (!token) return null;

  const sessionId = cookieStore.get(SESSION_COOKIE_NAME)?.value;
  if (!sessionId) return null;

  const payload = verifyImpersonationToken(token, sessionId);
  if (!payload || payload.adminUserId !== adminUserId) return null;

  return { salesRepId: payload.salesRepId };
}
