import { PrismaClient } from "@prisma/client";
import { MERCHANT_STATUSES } from "../src/lib/constants";
import { getOrCreateMerchantAccount } from "../src/lib/accounts";

const prisma = new PrismaClient();

/**
 * One-time, idempotent backfill for merchants approved before the
 * CustomerAccount ledger existed (updateMerchantStatus now creates one on
 * every future approval automatically — see src/app/admin/merchants/actions.ts).
 * Safe to run more than once: getOrCreateMerchantAccount no-ops for any
 * merchant that already has an account. Creates rows only, never deletes or
 * modifies anything.
 */
async function main() {
  const merchants = await prisma.merchant.findMany({
    where: { status: MERCHANT_STATUSES.APPROVED },
    select: { id: true, businessName: true },
  });

  let created = 0;
  for (const merchant of merchants) {
    const before = await prisma.customerAccount.findUnique({
      where: { merchantId: merchant.id },
      select: { id: true },
    });
    await getOrCreateMerchantAccount(prisma, merchant.id);
    if (!before) {
      created += 1;
      console.log("Created account for:", merchant.businessName);
    }
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
