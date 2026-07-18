import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { createSession } from "@/lib/auth/session";
import { getPostLoginRedirect } from "@/lib/auth/redirects";
import { ROLES } from "@/lib/constants";
import type { Role } from "@/types";
import {
  GOOGLE_STATE_COOKIE_NAME,
  exchangeGoogleCode,
  fetchGoogleUserInfo,
  getGoogleOAuthConfig,
  resolveRequestOrigin,
} from "@/lib/auth/google";

function errorRedirect(request: Request, code: string): NextResponse {
  return NextResponse.redirect(new URL(`/login?error=${code}`, resolveRequestOrigin(request)));
}

/** Google redirects the browser here after the consent screen. Validates
 * state (CSRF), exchanges the code for a token, fetches the verified email
 * from Google directly (never trusts anything client-submitted), then logs
 * in the matching existing user or creates a new RETAIL_CUSTOMER. */
export async function GET(request: Request) {
  const cookieStore = await cookies();
  const expectedState = cookieStore.get(GOOGLE_STATE_COOKIE_NAME)?.value;
  cookieStore.delete(GOOGLE_STATE_COOKIE_NAME);

  const config = getGoogleOAuthConfig();
  if (!config) {
    return errorRedirect(request, "google_unavailable");
  }

  const url = new URL(request.url);
  const googleError = url.searchParams.get("error");
  if (googleError) {
    return errorRedirect(request, "google_denied");
  }

  const state = url.searchParams.get("state");
  const code = url.searchParams.get("code");

  if (!state || !expectedState || state !== expectedState || !code) {
    return errorRedirect(request, "google_state");
  }

  const accessToken = await exchangeGoogleCode(config, code);
  if (!accessToken) {
    return errorRedirect(request, "google_failed");
  }

  const googleUser = await fetchGoogleUserInfo(accessToken);
  if (!googleUser) {
    return errorRedirect(request, "google_failed");
  }

  if (!googleUser.emailVerified) {
    return errorRedirect(request, "google_email_unverified");
  }

  const existingUser = await prisma.user.findUnique({
    where: { email: googleUser.email },
    include: { merchantProfile: true },
  });

  if (existingUser) {
    if (!existingUser.isActive) {
      return errorRedirect(request, "google_inactive");
    }

    // Role, passwordHash, and merchant/rep relations are never touched here
    // — Google login only ever authenticates into the existing account.
    await createSession(existingUser.id);
    return NextResponse.redirect(
      new URL(
        getPostLoginRedirect({
          role: existingUser.role as Role,
          merchantStatus: existingUser.merchantProfile?.status ?? null,
        }),
        resolveRequestOrigin(request),
      ),
    );
  }

  try {
    const newUser = await prisma.user.create({
      data: {
        email: googleUser.email,
        name: googleUser.name ?? googleUser.email.split("@")[0] ?? googleUser.email,
        role: ROLES.RETAIL_CUSTOMER,
        passwordHash: null,
        isActive: true,
      },
    });

    await createSession(newUser.id);
    return NextResponse.redirect(new URL("/dashboard", resolveRequestOrigin(request)));
  } catch (err) {
    // Concurrent signup created the same email between the lookup above and
    // this create — fall back to a fresh lookup rather than erroring.
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      const racedUser = await prisma.user.findUnique({ where: { email: googleUser.email } });
      if (racedUser && racedUser.isActive) {
        await createSession(racedUser.id);
        return NextResponse.redirect(new URL("/dashboard", resolveRequestOrigin(request)));
      }
    }
    console.error("[google-oauth] user create/session failed", {
      prismaCode: err instanceof Prisma.PrismaClientKnownRequestError ? err.code : undefined,
      message: err instanceof Error ? err.message : String(err),
    });
    return errorRedirect(request, "google_failed");
  }
}
