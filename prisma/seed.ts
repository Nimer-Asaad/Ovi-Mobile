import { PrismaClient } from "@prisma/client";
import { ROLES, STOCK_LOCATION_TYPES } from "../src/lib/constants";

const prisma = new PrismaClient();

/**
 * Phase 1 seed skeleton.
 *
 * This intentionally seeds the minimum needed to prove the schema and
 * pipeline work end to end: one admin user and one default warehouse
 * location. Later phases will extend this file to add categories, brands,
 * suppliers, sample products, a wholesale merchant, a sales representative
 * and their car-stock location, and sample orders — without needing to
 * restructure the script.
 *
 * Planned seed additions (by phase):
 * - Phase 3 (catalog): categories, brands, suppliers, sample products
 * - Phase 4 (merchants): a pending + an approved wholesale merchant
 * - Phase 5 (sales reps): a sales rep, their REP_CAR stock location,
 *   sample stock requests/returns
 * - Phase 6 (inventory): opening stock movements into the default warehouse
 * - Phase 7 (orders): sample retail/wholesale/rep-sale orders
 */
async function main() {
  const admin = await prisma.user.upsert({
    where: { email: "admin@ovimobile.ps" },
    update: {},
    create: {
      email: "admin@ovimobile.ps",
      name: "Ovi Mobile Admin",
      role: ROLES.ADMIN,
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

  console.log("Seeded admin user:", admin.email);
  console.log("Seeded default stock location:", mainWarehouse.name);
}

main()
  .catch((error) => {
    console.error("Seed failed:", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
