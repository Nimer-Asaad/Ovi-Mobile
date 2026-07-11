import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import {
  GOOGLE_STATE_COOKIE_NAME,
  GOOGLE_STATE_COOKIE_OPTIONS,
  GOOGLE_STATE_TTL_MS,
  buildGoogleAuthUrl,
  generateGoogleState,
  getGoogleOAuthConfig,
} from "@/lib/auth/google";

/** Entry point for "تسجيل الدخول بواسطة Google" — redirects to Google's
 * consent screen. Never renders anything itself. */
export async function GET(request: Request) {
  const config = getGoogleOAuthConfig();

  if (!config) {
    return NextResponse.redirect(new URL("/login?error=google_unavailable", request.url));
  }

  const state = generateGoogleState();
  const cookieStore = await cookies();
  cookieStore.set(GOOGLE_STATE_COOKIE_NAME, state, {
    ...GOOGLE_STATE_COOKIE_OPTIONS,
    expires: new Date(Date.now() + GOOGLE_STATE_TTL_MS),
  });

  return NextResponse.redirect(buildGoogleAuthUrl(config, state));
}
