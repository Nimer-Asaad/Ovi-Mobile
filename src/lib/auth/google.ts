import "server-only";
import { randomBytes } from "crypto";

/** Short-lived cookie holding the OAuth CSRF state value between the
 * /auth/google redirect and /auth/google/callback. Separate from the
 * session cookie — never used to authenticate anything. */
export const GOOGLE_STATE_COOKIE_NAME = "ovi_google_state";
export const GOOGLE_STATE_TTL_MS = 1000 * 60 * 10; // 10 minutes

export const GOOGLE_STATE_COOKIE_OPTIONS = {
  httpOnly: true,
  sameSite: "lax" as const,
  secure: process.env.NODE_ENV === "production",
  path: "/",
};

/// Max valid DNS hostname length (RFC 1035), plus room for an optional port.
const MAX_FORWARDED_HOST_LENGTH = 253;
/// hostname[:port] only — no scheme, path, spaces, or extra segments.
const FORWARDED_HOST_PATTERN = /^[a-zA-Z0-9.-]+(:\d+)?$/;

/** A reverse proxy chain can put multiple comma-separated values in these
 * headers; only the first, trimmed value is ever considered, and it must
 * look like a plain hostname[:port] within a sane length — anything else
 * (unbounded length, embedded scheme/path, multiple hosts) is rejected
 * rather than trusted. */
function normalizeForwardedHost(value: string | null): string | null {
  if (!value) return null;
  const candidate = value.split(",")[0]?.trim();
  if (!candidate || candidate.length > MAX_FORWARDED_HOST_LENGTH || !FORWARDED_HOST_PATTERN.test(candidate)) {
    return null;
  }
  return candidate;
}

function normalizeForwardedProto(value: string | null): "http" | "https" | null {
  if (!value) return null;
  const candidate = value.split(",")[0]?.trim().toLowerCase();
  return candidate === "http" || candidate === "https" ? candidate : null;
}

/** Resolves the public-facing origin for building OAuth redirect targets.
 * `next start` behind a reverse proxy does not reflect the proxy's Host
 * header in `request.url` — it always reports the Node server's own bind
 * address (e.g. "http://localhost:3000") — so this prefers the proxy's
 * forwarded headers (nginx sets Host / X-Forwarded-Proto here; X-Forwarded-
 * Host is checked too in case that changes) and only falls back to
 * `request.url`'s origin when neither header is present, which keeps local
 * `next dev` (no proxy in front) working exactly as before. Every candidate
 * is normalized to a single, validated value — never trusted as an
 * unbounded or comma-separated string straight from the header. */
export function resolveRequestOrigin(request: Request): string {
  const forwardedHost =
    normalizeForwardedHost(request.headers.get("x-forwarded-host")) ??
    normalizeForwardedHost(request.headers.get("host"));

  if (!forwardedHost) {
    return new URL(request.url).origin;
  }

  const requestUrlProto = new URL(request.url).protocol.replace(":", "");
  const forwardedProto =
    normalizeForwardedProto(request.headers.get("x-forwarded-proto")) ??
    (requestUrlProto === "http" || requestUrlProto === "https" ? requestUrlProto : "https");

  return `${forwardedProto}://${forwardedHost}`;
}

export interface GoogleOAuthConfig {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
}

/** Reads the three required env vars. Returns null (never throws) if any
 * are missing, so callers can redirect to a safe error instead of crashing. */
export function getGoogleOAuthConfig(): GoogleOAuthConfig | null {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  const redirectUri = process.env.GOOGLE_REDIRECT_URI;

  if (!clientId || !clientSecret || !redirectUri) {
    return null;
  }

  return { clientId, clientSecret, redirectUri };
}

export function generateGoogleState(): string {
  return randomBytes(32).toString("hex");
}

export function buildGoogleAuthUrl(config: GoogleOAuthConfig, state: string): string {
  const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  url.searchParams.set("client_id", config.clientId);
  url.searchParams.set("redirect_uri", config.redirectUri);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", "openid email profile");
  url.searchParams.set("state", state);
  url.searchParams.set("prompt", "select_account");
  return url.toString();
}

interface GoogleTokenResponse {
  access_token: string;
  token_type: string;
  expires_in: number;
}

/** Exchanges an authorization code for an access token. Returns null on any
 * failure (network error, bad response shape, non-2xx status) instead of
 * throwing, so the callback route can redirect to a safe error page. */
export async function exchangeGoogleCode(
  config: GoogleOAuthConfig,
  code: string,
): Promise<string | null> {
  try {
    const response = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code,
        client_id: config.clientId,
        client_secret: config.clientSecret,
        redirect_uri: config.redirectUri,
        grant_type: "authorization_code",
      }),
    });

    if (!response.ok) {
      const errorBody = (await response.json().catch(() => null)) as
        | { error?: string; error_description?: string }
        | null;
      console.error("[google-oauth] token exchange rejected by Google", {
        status: response.status,
        error: errorBody?.error,
        error_description: errorBody?.error_description,
      });
      return null;
    }

    const data = (await response.json()) as Partial<GoogleTokenResponse>;
    if (typeof data.access_token !== "string") {
      console.error("[google-oauth] token exchange response missing access_token");
      return null;
    }
    return data.access_token;
  } catch (err) {
    console.error("[google-oauth] token exchange request threw", {
      message: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
}

export interface GoogleUserInfo {
  email: string;
  emailVerified: boolean;
  name: string | null;
}

/** Fetches the authenticated user's profile from Google using the access
 * token obtained via exchangeGoogleCode — this is the only source of truth
 * for the user's email; nothing client-submitted is ever trusted. */
export async function fetchGoogleUserInfo(accessToken: string): Promise<GoogleUserInfo | null> {
  try {
    const response = await fetch("https://openidconnect.googleapis.com/v1/userinfo", {
      headers: { Authorization: `Bearer ${accessToken}` },
    });

    if (!response.ok) {
      console.error("[google-oauth] userinfo fetch rejected by Google", { status: response.status });
      return null;
    }

    const data = (await response.json()) as {
      email?: string;
      email_verified?: boolean | string;
      name?: string;
    };

    if (!data.email || typeof data.email !== "string") {
      console.error("[google-oauth] userinfo response missing email");
      return null;
    }

    return {
      email: data.email.trim().toLowerCase(),
      emailVerified: data.email_verified === true || data.email_verified === "true",
      name: typeof data.name === "string" && data.name.trim() ? data.name.trim() : null,
    };
  } catch (err) {
    console.error("[google-oauth] userinfo request threw", {
      message: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
}
