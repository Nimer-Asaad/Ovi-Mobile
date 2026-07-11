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

    if (!response.ok) return null;

    const data = (await response.json()) as Partial<GoogleTokenResponse>;
    return typeof data.access_token === "string" ? data.access_token : null;
  } catch {
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

    if (!response.ok) return null;

    const data = (await response.json()) as {
      email?: string;
      email_verified?: boolean | string;
      name?: string;
    };

    if (!data.email || typeof data.email !== "string") return null;

    return {
      email: data.email.trim().toLowerCase(),
      emailVerified: data.email_verified === true || data.email_verified === "true",
      name: typeof data.name === "string" && data.name.trim() ? data.name.trim() : null,
    };
  } catch {
    return null;
  }
}
