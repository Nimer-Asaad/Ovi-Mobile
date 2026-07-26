import { PrismaClient } from "@prisma/client";
import { MERCHANT_STATUSES } from "../src/lib/constants";

const prisma = new PrismaClient();

/**
 * One-time, idempotent backfill for merchants approved before the
 * CustomerAccount ledger existed (updateMerchantStatus now creates one on
 * every future approval automatically — see src/app/admin/merchants/actions.ts).
 * Safe to run more than once: skips any merchant that already has an
 * account. Creates rows only, never deletes or modifies anything.
 *
 * Deliberately does not import src/lib/accounts.ts's getOrCreateMerchantAccount
 * — that module is guarded with `import "server-only"`, which throws when
 * run outside Next.js's bundler (as this standalone tsx script does). A
 * plain find-or-create is fine here since this runs once, single-threaded,
 * with no concurrent request racing against it — unlike the app's own
 * checkout/manual-order paths, which do need that helper's P2002 handling.
 */
async function main() {
  const merchants = await prisma.merchant.findMany({
    where: { status: MERCHANT_STATUSES.APPROVED },
    select: { id: true, businessName: true, user: { select: { phone: true } } },
  });

  let created = 0;
  for (const merchant of merchants) {
    const existing = await prisma.customerAccount.findUnique({
      where: { merchantId: merchant.id },
      select: { id: true },
    });
    if (existing) continue;

    await prisma.customerAccount.create({
      data: { displayName: merchant.businessName, phone: merchant.user.phone, merchantId: merchant.id },
    });
    created += 1;
    console.log("Created account for:", merchant.businessName);
  }

  console.log(`Done — ${created} account(s) created, ${merchants.length - created} already existed.`);
}

main()
  .catch((error) => {
    console.error("Backfill failed:", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
