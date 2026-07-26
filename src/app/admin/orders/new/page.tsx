import { prisma } from "@/lib/prisma";
import { PageHeader } from "@/components/ui/PageHeader";
import { ManualOrderForm } from "@/components/admin/orders/ManualOrderForm";
import { ROLES, MERCHANT_STATUSES } from "@/lib/constants";

/** Preloads everything the manual-order form needs — customers, approved
 * merchants, and active products with Main Warehouse stock — as plain
 * arrays passed into the Client Component. The dataset is small enough
 * (demo/small-business scale) that a full preload + local filter is
 * simpler and safer than building a new search API route for this phase. */
interface NewManualOrderPageProps {
  searchParams: Promise<{
    mode?: string;
    merchantId?: string;
    customerId?: string;
    walkInAccountId?: string;
  }>;
}

export default async function NewManualOrderPage({ searchParams }: NewManualOrderPageProps) {
  const { mode, merchantId, customerId, walkInAccountId } = await searchParams;
  const [customers, merchants, products, walkInAccounts] = await Promise.all([
    prisma.user.findMany({
      where: { role: ROLES.RETAIL_CUSTOMER, isActive: true },
      select: { id: true, name: true, email: true, phone: true },
      orderBy: { name: "asc" },
    }),
    prisma.merchant.findMany({
      where: { status: MERCHANT_STATUSES.APPROVED, user: { isActive: true } },
      select: {
        id: true,
        businessName: true,
        user: { select: { id: true, name: true, email: true, phone: true } },
      },
      orderBy: { businessName: "asc" },
    }),
    prisma.product.findMany({
      where: { isActive: true },
      select: {
        id: true,
        sku: true,
        name: true,
        nameAr: true,
        retailPriceCents: true,
        wholesalePriceCents: true,
        category: { select: { name: true, nameAr: true } },
        brand: { select: { name: true } },
        inventoryItems: { where: { location: { isDefault: true } }, select: { quantity: true } },
      },
      orderBy: { name: "asc" },
    }),
    // Pure walk-in debt accounts only (no merchant/customer already covers
    // those two identities) — offered as "use an existing account" when the
    // admin tracks a WALK_IN sale as debt.
    prisma.customerAccount.findMany({
      where: { merchantId: null, customerId: null, isActive: true },
      select: { id: true, displayName: true, phone: true },
      orderBy: { displayName: "asc" },
    }),
  ]);

  const productOptions = products.map((product) => ({
    id: product.id,
    sku: product.sku,
    name: product.name,
    nameAr: product.nameAr,
    retailPriceCents: product.retailPriceCents,
    wholesalePriceCents: product.wholesalePriceCents,
    categoryLabel: product.category?.nameAr ?? product.category?.name ?? null,
    brandLabel: product.brand?.name ?? null,
    stock: product.inventoryItems.reduce((sum, item) => sum + item.quantity, 0),
  }));

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="طلب يدوي جديد" subtitle="إنشاء طلب من داخل لوحة التحكم لعميل أو تاجر جملة أو عميل مباشر" />
      <ManualOrderForm
        customers={customers}
        merchants={merchants}
        products={productOptions}
        walkInAccounts={walkInAccounts}
        initialMode={mode}
        initialMerchantId={merchantId}
        initialCustomerId={customerId}
        initialWalkInAccountId={walkInAccountId}
      />
    </div>
  );
}
