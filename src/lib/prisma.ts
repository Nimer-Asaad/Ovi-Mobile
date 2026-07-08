import { PrismaClient } from "@prisma/client";

/**
 * Prisma client singleton.
 *
 * Next.js dev mode reloads modules on every change, which would otherwise
 * exhaust the SQLite/Postgres connection pool by creating a new PrismaClient
 * per reload. Caching the instance on `globalThis` in non-production avoids
 * that. See: https://www.prisma.io/docs/guides/nextjs
 */
const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: process.env.NODE_ENV === "development" ? ["warn", "error"] : ["error"],
  });

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}
