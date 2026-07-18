import "server-only";
import { cookies } from "next/headers";
import { prisma } from "@/lib/prisma";
import { SESSION_COOKIE_NAME, SESSION_TTL_MS } from "@/lib/auth/session-constants";
import { getRequestContext } from "@/lib/activity";
import { USER_ACTIVITY_EVENT_TYPES } from "@/lib/constants";
import type { Role } from "@/types";

const COOKIE_OPTIONS = {
  httpOnly: true,
  sameSite: "lax" as const,
  secure: process.env.NODE_ENV === "production",
  path: "/",
};

/** How stale User.lastActiveAt must be before getSession() bothers writing a
 * fresh value — keeps "last seen" real without turning every page load into
 * an extra write. */
const LAST_ACTIVE_REFRESH_MS = 5 * 60 * 1000;

/** Records a real LOGIN/LOGOUT event from the actual request context. Never
 * throws — activity tracking must never be able to break auth itself. */
async function recordActivity(userId: string, type: string): Promise<void> {
  const context = await getRequestContext();
  await prisma.userActivityEvent
    .create({
      data: {
        userId,
        type,
        ipAddress: context.ipAddress,
        userAgent: context.userAgent,
        device: context.device,
        browser: context.browser,
        os: context.os,
      },
    })
    .catch(() => {});
}

export interface SessionUser {
  id: string;
  role: Role;
  name: string;
  email: string;
  /** Only meaningful when role is WHOLESALE_MERCHANT; null otherwise. */
  merchantStatus: string | null;
}

/** Create a DB-backed session row and set the opaque session cookie. Also
 * records a real LOGIN activity event and refreshes lastLoginAt/lastActiveAt
 * — used by every login/registration path (email/password, Google, customer
 * and merchant self-registration), so this is the single place all of them
 * become visible in the Users admin section. */
export async function createSession(userId: string): Promise<void> {
  const session = await prisma.session.create({
    data: { userId, expiresAt: new Date(Date.now() + SESSION_TTL_MS) },
  });

  const cookieStore = await cookies();
  cookieStore.set(SESSION_COOKIE_NAME, session.id, {
    ...COOKIE_OPTIONS,
    expires: session.expiresAt,
  });

  const now = new Date();
  await prisma.user
    .update({ where: { id: userId }, data: { lastLoginAt: now, lastActiveAt: now } })
    .catch(() => {});
  await recordActivity(userId, USER_ACTIVITY_EVENT_TYPES.LOGIN);
}

/** Resolve the current session cookie to a user, or null if absent/expired.
 * Never returns `passwordHash` — only the fields safe to pass to a client. */
export async function getSession(): Promise<SessionUser | null> {
  const cookieStore = await cookies();
  const sessionId = cookieStore.get(SESSION_COOKIE_NAME)?.value;
  if (!sessionId) return null;

  const session = await prisma.session.findUnique({
    where: { id: sessionId },
    include: { user: { include: { merchantProfile: true } } },
  });

  if (!session) return null;

  if (session.expiresAt < new Date()) {
    await prisma.session.delete({ where: { id: session.id } }).catch(() => {});
    return null;
  }

  // A disabled account must lose access on its very next request, not just
  // on its next login attempt — an already-issued session cookie would
  // otherwise keep working for up to SESSION_TTL_MS (30 days) after an
  // admin disables the account. toggleUserActive() also proactively deletes
  // all of a user's sessions the moment they're disabled; this check is the
  // backstop for any session that predates that action or survives it.
  if (!session.user.isActive) {
    await prisma.session.delete({ where: { id: session.id } }).catch(() => {});
    return null;
  }

  const now = new Date();
  const lastActive = session.user.lastActiveAt;
  if (!lastActive || now.getTime() - lastActive.getTime() > LAST_ACTIVE_REFRESH_MS) {
    await prisma.user.update({ where: { id: session.user.id }, data: { lastActiveAt: now } }).catch(() => {});
  }

  return {
    id: session.user.id,
    role: session.user.role as Role,
    name: session.user.name,
    email: session.user.email,
    merchantStatus: session.user.merchantProfile?.status ?? null,
  };
}

/** Delete the session row (if any), record a real LOGOUT activity event,
 * and clear the cookie. */
export async function destroySession(): Promise<void> {
  const cookieStore = await cookies();
  const sessionId = cookieStore.get(SESSION_COOKIE_NAME)?.value;

  if (sessionId) {
    const session = await prisma.session
      .findUnique({ where: { id: sessionId }, select: { userId: true } })
      .catch(() => null);

    await prisma.session.delete({ where: { id: sessionId } }).catch(() => {});

    if (session) {
      await recordActivity(session.userId, USER_ACTIVITY_EVENT_TYPES.LOGOUT);
    }
  }

  cookieStore.delete(SESSION_COOKIE_NAME);
}
