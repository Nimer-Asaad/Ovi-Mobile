/**
 * Edge-safe auth constants — no Prisma import here. This file is imported by
 * both `middleware.ts` (Edge runtime) and `session.ts` (Node runtime), so it
 * must stay free of anything that can't run on Edge.
 */

export const SESSION_COOKIE_NAME = "ovi_session";
export const SESSION_TTL_MS = 1000 * 60 * 60 * 24 * 30; // 30 days
