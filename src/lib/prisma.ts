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
    // Prisma's interactive $transaction defaults (maxWait: 2000ms,
    // timeout: 5000ms) are tuned for a low-latency DB connection. Several
    // stock/order actions run a handful of sequential queries inside one
    // transaction (order create + a decrement/read/movement-create per
    // line), which can exceed 5s under a slow connection to Supabase and
    // fail with P2028 ("Transaction not found") even though every query
    // involved is fast — the transaction simply times out waiting on
    // round-trips. Raising both applies globally to every $transaction
    // call without changing any transaction's logic or rollback behavior.
    transactionOptions: {
      maxWait: 10000,
      timeout: 30000,
    },
  });

globalForPrisma.prisma = prisma;
