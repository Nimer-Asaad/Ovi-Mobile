import "server-only";
import { cookies } from "next/headers";
import { prisma } from "@/lib/prisma";
import { SESSION_COOKIE_NAME, SESSION_TTL_MS } from "@/lib/auth/session-constants";
import type { Role } from "@/types";

const COOKIE_OPTIONS = {
  httpOnly: true,
  sameSite: "lax" as const,
  secure: process.env.NODE_ENV === "production",
  path: "/",
};

export interface SessionUser {
  id: string;
  role: Role;
  name: string;
  email: string;
  /** Only meaningful when role is WHOLESALE_MERCHANT; null otherwise. */
  merchantStatus: string | null;
}

/** Create a DB-backed session row and set the opaque session cookie. */
export async function createSession(userId: string): Promise<void> {
  const session = await prisma.session.create({
    data: { userId, expiresAt: new Date(Date.now() + SESSION_TTL_MS) },
  });

  const cookieStore = await cookies();
  cookieStore.set(SESSION_COOKIE_NAME, session.id, {
    ...COOKIE_OPTIONS,
    expires: session.expiresAt,
  });
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

  return {
    id: session.user.id,
    role: session.user.role as Role,
    name: session.user.name,
    email: session.user.email,
    merchantStatus: session.user.merchantProfile?.status ?? null,
  };
}

/** Delete the session row (if any) and clear the cookie. */
export async function destroySession(): Promise<void> {
  const cookieStore = await cookies();
  const sessionId = cookieStore.get(SESSION_COOKIE_NAME)?.value;

  if (sessionId) {
    await prisma.session.delete({ where: { id: sessionId } }).catch(() => {});
  }

  cookieStore.delete(SESSION_COOKIE_NAME);
}
