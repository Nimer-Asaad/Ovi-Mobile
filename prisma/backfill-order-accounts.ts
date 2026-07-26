import { PrismaClient } from "@prisma/client";
import { ACCOUNT_PAYMENT_METHODS } from "../src/lib/constants";

const prisma = new PrismaClient();

/**
 * One-time, idempotent backfill: attaches Order.accountId for any order
 * whose customer or merchant already has a CustomerAccount but wasn't
 * linked when the order was created — most notably, ordinary retail
 * checkout orders placed before checkout/actions.ts started checking for
 * an existing customer account (previously only wholesale orders attached
 * automatically). Only ever sets accountId when it's currently null and a
 * matching account exists — never overwrites an existing link, never
 * creates a new account. Mirrors any already-paid amount into the ledger
 * as a payment (same reasoning as recordInitialAccountPayment in
 * src/lib/accounts.ts) so a previously-settled order doesn't suddenly show
 * up as outstanding debt once attached. Safe to run more than once.
 *
 * Deliberately avoids importing src/lib/accounts.ts (server-only guarded,
 * throws outside Next.js's bundler) — same reasoning as
 * backfill-merchant-accounts.ts.
 */
async function main() {
  const orders = await prisma.order.findMany({
    where: {
      accountId: null,
      OR: [{ customerId: { not: null } }, { merchantId: { not: null } }],
    },
    select: {
      id: true,
      orderNumber: true,
      customerId: true,
      merchantId: true,
      paidAmountCents: true,
    },
  });

  let attached = 0;
  let paymentsMirrored = 0;

  for (const order of orders) {
    let accountId: string | null = null;

    if (order.merchantId) {
      const account = await prisma.customerAccount.findUnique({
        where: { merchantId: order.merchantId },
        select: { id: true },
      });
      accountId = account?.id ?? null;
    }

    if (!accountId && order.customerId) {
      const account = await prisma.customerAccount.findUnique({
        where: { customerId: order.customerId },
        select: { id: true },
      });
      accountId = account?.id ?? null;
    }

    if (!accountId) continue;

    await prisma.order.update({ where: { id: order.id }, data: { accountId } });
    attached += 1;
    console.log("Attached order to account:", order.orderNumber);

    if (order.paidAmountCents > 0 && order.customerId) {
      await prisma.accountPayment.create({
        data: {
          accountId,
          amountCents: order.paidAmountCents,
          method: ACCOUNT_PAYMENT_METHODS.CASH,
          note: `دفعة مسجّلة سابقاً — طلب ${order.orderNumber} (تصحيح ربط الحساب)`,
          createdById: order.customerId,
        },
      });
      paymentsMirrored += 1;
      console.log("  mirrored existing payment for:", order.orderNumber);
    }
  }

  console.log(
    `Done — ${attached} order(s) attached (${paymentsMirrored} with a mirrored payment), ${orders.length - attached} had no matching account.`,
  );
}

main()
  .catch((error) => {
    console.error("Backfill failed:", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
