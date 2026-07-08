import { PrismaClient } from "@prisma/client";
import { ROLES, STOCK_LOCATION_TYPES, MERCHANT_STATUSES } from "../src/lib/constants";
import { hashPassword } from "../src/lib/auth/password";

const prisma = new PrismaClient();

/**
 * Phase 2 seed: one account per role (plus a pending merchant) so the
 * auth/RBAC flows can be exercised end to end. Passwords are for local
 * development only — see README "Development Accounts".
 *
 * Planned seed additions (by phase):
 * - Phase 3 (catalog): categories, brands, suppliers, sample products
 * - Phase 6 (inventory): opening stock movements into the default warehouse
 * - Phase 7 (orders): sample retail/wholesale/rep-sale orders
 */
async function main() {
  const admin = await prisma.user.upsert({
    where: { email: "admin@ovimobile.ps" },
    update: { passwordHash: hashPassword("Admin12345!") },
    create: {
      email: "admin@ovimobile.ps",
      name: "Ovi Mobile Admin",
      role: ROLES.ADMIN,
      passwordHash: hashPassword("Admin12345!"),
    },
  });

  const mainWarehouse = await prisma.stockLocation.upsert({
    where: { id: "main-warehouse" },
    update: {},
    create: {
      id: "main-warehouse",
      type: STOCK_LOCATION_TYPES.WAREHOUSE,
      name: "Main Warehouse",
      isDefault: true,
    },
  });

  const approvedMerchant = await prisma.user.upsert({
    where: { email: "merchant.approved@ovimobile.ps" },
    update: { passwordHash: hashPassword("Merchant12345!") },
    create: {
      email: "merchant.approved@ovimobile.ps",
      name: "تاجر معتمد",
      role: ROLES.WHOLESALE_MERCHANT,
      passwordHash: hashPassword("Merchant12345!"),
      merchantProfile: {
        create: {
          businessName: "متجر الأمل للإكسسوارات",
          status: MERCHANT_STATUSES.APPROVED,
          approvedAt: new Date(),
        },
      },
    },
  });

  const pendingMerchant = await prisma.user.upsert({
    where: { email: "merchant.pending@ovimobile.ps" },
    update: { passwordHash: hashPassword("Merchant12345!") },
    create: {
      email: "merchant.pending@ovimobile.ps",
      name: "تاجر قيد المراجعة",
      role: ROLES.WHOLESALE_MERCHANT,
      passwordHash: hashPassword("Merchant12345!"),
      merchantProfile: {
        create: {
          businessName: "متجر النور",
          status: MERCHANT_STATUSES.PENDING,
        },
      },
    },
  });

  const salesRep = await prisma.user.upsert({
    where: { email: "rep@ovimobile.ps" },
    update: { passwordHash: hashPassword("Rep12345!") },
    create: {
      email: "rep@ovimobile.ps",
      name: "مندوب المبيعات",
      role: ROLES.SALES_REPRESENTATIVE,
      passwordHash: hashPassword("Rep12345!"),
      salesRepresentativeProfile: {
        create: {
          employeeCode: "REP-001",
        },
      },
    },
  });

  const customer = await prisma.user.upsert({
    where: { email: "customer@ovimobile.ps" },
    update: { passwordHash: hashPassword("Customer12345!") },
    create: {
      email: "customer@ovimobile.ps",
      name: "عميل تجريبي",
      role: ROLES.RETAIL_CUSTOMER,
      passwordHash: hashPassword("Customer12345!"),
    },
  });

  console.log("Seeded admin user:", admin.email);
  console.log("Seeded default stock location:", mainWarehouse.name);
  console.log("Seeded approved merchant:", approvedMerchant.email);
  console.log("Seeded pending merchant:", pendingMerchant.email);
  console.log("Seeded sales rep:", salesRep.email);
  console.log("Seeded customer:", customer.email);
}

main()
  .catch((error) => {
    console.error("Seed failed:", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
