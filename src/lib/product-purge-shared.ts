/** Plain types/constants shared between the server-only purge logic
 * (src/lib/product-purge.ts) and the client purge workspace component
 * (src/components/admin/products/ProductPurgeWorkspace.tsx). Deliberately
 * has NO "server-only" import and NO Prisma import — it exists purely so
 * the client bundle can safely import the dependency-count labels and the
 * confirmation phrase without pulling in server-only.ts (which throws if a
 * bundler resolves it into client code) or @prisma/client. */

/** Server-side hard cap on how many products one purge batch may target —
 * independent of anything the client sends, re-enforced in the server
 * action before any read/write. */
export const MAX_PURGE_BATCH_SIZE = 100;

/** The exact phrase an admin must type, verbatim, before the purge action
 * will run — checked server-side (never trusted from a disabled-button
 * state alone). */
export const PURGE_CONFIRMATION_PHRASE = "حذف نهائي";

export interface ProductPurgeDependencyCounts {
  stockMovements: number;
  productVariantAllocationBatches: number;
  repCustomerOrderItems: number;
  stockReturnItems: number;
  stockRequestItems: number;
  cartItems: number;
  wishlistItems: number;
  orderItems: number;
  inventoryItems: number;
  productColorOptions: number;
  productImages: number;
  deviceColorVariants: number;
  productVariants: number;
}

/** Arabic labels for the dependency-count keys above, in the same order —
 * shared by the preview screen and the post-purge audit summary so both
 * always show identical wording for the identical underlying count. */
export const PRODUCT_DEPENDENCY_LABELS: Record<keyof ProductPurgeDependencyCounts, string> = {
  stockMovements: "حركات المخزون",
  productVariantAllocationBatches: "دفعات توزيع المخزون القديم",
  repCustomerOrderItems: "بنود طلبات زبائن المندوبين",
  stockReturnItems: "بنود إرجاع المخزون (نظام قديم)",
  stockRequestItems: "بنود طلبات مخزون المندوبين",
  cartItems: "عناصر السلة الحالية",
  wishlistItems: "عناصر المفضلة",
  orderItems: "بنود الطلبات / الفواتير",
  inventoryItems: "صفوف المخزون (كل الفروع، شامل الصفوف الصفرية)",
  productColorOptions: "خيارات الألوان المعروضة للمنتج",
  productImages: "الصور",
  deviceColorVariants: "تركيبات الجهاز واللون",
  productVariants: "متغيرات الموديل",
};

export interface ProductPurgeRowSummary {
  id: string;
  sku: string;
  name: string;
  nameAr: string | null;
  isActive: boolean;
  /** Sum of every WAREHOUSE InventoryItem row (any dimension) — same
   * definition as getCompanyInventoryReport. */
  warehouseStock: number;
  /** Sum of ONLY the plain aggregate REP_CAR row(s) (variantId AND
   * deviceColorVariantId both null) — same definition as
   * getCompanyInventoryReport. */
  repStock: number;
  companyTotal: number;
}

/** Counts of shared-parent rows that would become / did become fully empty
 * of any (non-purged-product) child once the selected products' own child
 * rows are removed — and are therefore themselves deleted too, so a
 * test-only order/request/return/etc. doesn't linger as an empty shell. A
 * parent that still has even one child belonging to a NON-selected product
 * is never counted here and never deleted — see the shared-parent
 * protection doc comment on purgeProductsInTransaction. */
export interface EmptyParentCounts {
  orders: number;
  stockRequests: number;
  stockReturns: number;
  repCustomerOrders: number;
  repStockTransferBatches: number;
}

export const EMPTY_PARENT_LABELS: Record<keyof EmptyParentCounts, string> = {
  orders: "طلبات (فواتير) فارغة بالكامل",
  stockRequests: "طلبات مخزون مندوبين فارغة بالكامل",
  stockReturns: "مرتجعات مخزون فارغة بالكامل (نظام قديم)",
  repCustomerOrders: "طلبات زبائن مندوبين فارغة بالكامل",
  repStockTransferBatches: "دفعات تحويل مخزون فارغة بالكامل",
};

export interface ProductPurgePreview {
  rows: ProductPurgeRowSummary[];
  dependencyCounts: ProductPurgeDependencyCounts;
  totalInventoryUnits: number;
  /** Parents that would be deleted along with the selected products because
   * every child they have belongs to a purged product. */
  emptyParentsToDelete: EmptyParentCounts;
  /** Orders that WOULD have become empty, but are deliberately left as
   * historical shells because they carry a debt-ledger link (accountId) —
   * see the doc comment on purgeProductsInTransaction for why this can
   * never be resolved automatically (AccountPayment has no FK back to a
   * specific Order). Shown so this is never a silent decision. */
  protectedAccountLinkedOrders: number;
}

export interface ProductPurgeResult {
  deletedProducts: ProductPurgeRowSummary[];
  dependencyCounts: ProductPurgeDependencyCounts;
  totalInventoryPurged: number;
  emptyParentsDeleted: EmptyParentCounts;
  protectedAccountLinkedOrders: number;
}
