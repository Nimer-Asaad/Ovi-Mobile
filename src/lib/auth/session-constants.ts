/**
 * Edge-safe auth constants — no Prisma import here. This file is imported by
 * both `middleware.ts` (Edge runtime) and `session.ts` (Node runtime), so it
 * must stay free of anything that can't run on Edge.
 */

export const SESSION_COOKIE_NAME = "ovi_session";
export const SESSION_TTL_MS = 1000 * 60 * 60 * 24 * 30; // 30 days

/** The impersonation cookie's name only — kept here (not in
 * src/lib/auth/impersonation.ts) purely so session.ts can delete it on
 * login/logout without importing impersonation.ts, which would create a
 * runtime import cycle (impersonation.ts -> guards.ts -> session.ts). Both
 * modules import this one name from this single leaf file instead. */
export const IMPERSONATION_COOKIE_NAME = "ovi_impersonation_rep_id";
