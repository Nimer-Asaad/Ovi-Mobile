import { PrismaClient } from "@prisma/client";

/**
 * Prisma client singleton.
 *
 * Next.js dev mode reloads modules on every change, which would otherwise
 * exhaust the Postgres connection pool by creating a new PrismaClient per
 * reload. Caching the instance on `globalThis` avoids that — in every
 * environment, not just non-production, so a warm Vercel serverless
 * instance also reuses one client (and one connection pool) across
 * invocations instead of risking a second instantiation. See:
 * https://www.prisma.io/docs/guides/nextjs
 */
const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: process.env.NODE_ENV === "development" ? ["warn", "error"] : ["error"],
  });

globalForPrisma.prisma = prisma;
