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

// Brand → model[ → color] order, matching the same stable sequence used by
// the device-inventory grouped UI and the admin/inventory/adjust cascade.
const BRAND_MODEL_ORDER = [
  { phoneModel: { phoneBrand: { sortOrder: "asc" as const } } },
  { phoneModel: { phoneBrand: { name: "asc" as const } } },
  { phoneModel: { sortOrder: "asc" as const } },
  { phoneModel: { name: "asc" as const } },
  { sortOrder: "asc" as const },
];

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
        inventoryItems: {
          where: { location: { isDefault: true } },
          select: { quantity: true, variantId: true, deviceColorVariantId: true },
        },
        colorOptions: {
          select: { color: { select: { id: true, name: true, nameAr: true, hexCode: true } } },
          orderBy: { sortOrder: "asc" },
        },
        // Active only — order creation is a sale-facing flow (like
        // cart/checkout/rep-sale), unlike admin/inventory/adjust which
        // deliberately shows disabled rows for restocking.
        variants: {
          where: { isActive: true },
          orderBy: BRAND_MODEL_ORDER,
          select: {
            id: true,
            phoneModel: { select: { id: true, name: true, nameAr: true, phoneBrandId: true, phoneBrand: { select: { id: true, name: true, nameAr: true } } } },
          },
        },
        deviceColorVariants: {
          where: { isActive: true },
          orderBy: BRAND_MODEL_ORDER,
          select: {
            id: true,
            phoneModel: { select: { id: true, name: true, nameAr: true, phoneBrandId: true, phoneBrand: { select: { id: true, name: true, nameAr: true } } } },
            color: { select: { id: true, name: true, nameAr: true, hexCode: true } },
          },
        },
        variantMode: true,
        variantAllocationStatus: true,
        inventoryTrackingMode: true,
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
    // Plain (non-variant, non-combo) total — a phone-variant product's
    // purchasable stock is per-model instead (variantOptions[].stock), and a
    // DEVICE_MODEL_COLOR product's is per-combination
    // (deviceColorVariantOptions[].stock). Color never affects stock on its
    // own either way — see the InventoryItem doc comment in schema.prisma.
    stock: product.inventoryItems.filter((item) => !item.variantId && !item.deviceColorVariantId).reduce((sum, item) => sum + item.quantity, 0),
    // Never populated for a DEVICE_MODEL_COLOR product — its color is
    // already part of deviceColorVariantOptions below, matching the same
    // convention already used in rep/sales/new/page.tsx.
    colorOptions: product.inventoryTrackingMode === "DEVICE_MODEL_COLOR" ? [] : product.colorOptions.map((option) => ({
      id: option.color.id,
      name: option.color.name,
      nameAr: option.color.nameAr,
      hexCode: option.color.hexCode,
    })),
    variantOptions: product.variantMode === "PHONE_COMPATIBILITY" && product.variantAllocationStatus === "READY"
      ? product.variants.map((variant) => ({
          id: variant.id,
          phoneBrandId: variant.phoneModel.phoneBrandId,
          brandLabel: variant.phoneModel.phoneBrand.nameAr ?? variant.phoneModel.phoneBrand.name,
          phoneModelId: variant.phoneModel.id,
          modelLabel: variant.phoneModel.nameAr ?? variant.phoneModel.name,
          stock: product.inventoryItems.find((item) => item.variantId === variant.id)?.quantity ?? 0,
        }))
      : [],
    deviceColorVariantOptions: product.inventoryTrackingMode === "DEVICE_MODEL_COLOR"
      ? product.deviceColorVariants.map((combo) => ({
          id: combo.id,
          phoneBrandId: combo.phoneModel.phoneBrandId,
          brandLabel: combo.phoneModel.phoneBrand.nameAr ?? combo.phoneModel.phoneBrand.name,
          phoneModelId: combo.phoneModel.id,
          modelLabel: combo.phoneModel.nameAr ?? combo.phoneModel.name,
          colorId: combo.color.id,
          colorLabel: combo.color.nameAr ?? combo.color.name,
          colorHex: combo.color.hexCode,
          stock: product.inventoryItems.find((item) => item.deviceColorVariantId === combo.id)?.quantity ?? 0,
        }))
      : [],
  }));

  // The query above filters `user: { isActive: true }`, which only matches
  // merchants with a real linked User row — a login-less trader (userId
  // null) can never appear here, so `user` is guaranteed non-null at this
  // point despite Merchant.user now being an optional relation in general.
  const merchantOptions = merchants.map((merchant) => ({ ...merchant, user: merchant.user! }));

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="طلب يدوي جديد" subtitle="إنشاء طلب من داخل لوحة التحكم لعميل أو تاجر جملة أو عميل مباشر" />
      <ManualOrderForm
        customers={customers}
        merchants={merchantOptions}
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
