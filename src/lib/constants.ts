/**
 * Centralized constants for Ovi Mobile.
 *
 * These are the canonical value sets backing the "string enum" fields in
 * prisma/schema.prisma (SQLite has no native enum type, see the note at the
 * top of that file). Always import from here instead of hardcoding string
 * literals in components or server code.
 */

export const ROLES = {
  ADMIN: "ADMIN",
  RETAIL_CUSTOMER: "RETAIL_CUSTOMER",
  WHOLESALE_MERCHANT: "WHOLESALE_MERCHANT",
  SALES_REPRESENTATIVE: "SALES_REPRESENTATIVE",
} as const;

export const MERCHANT_STATUSES = {
  PENDING: "PENDING",
  APPROVED: "APPROVED",
  REJECTED: "REJECTED",
  SUSPENDED: "SUSPENDED",
} as const;

export const STOCK_LOCATION_TYPES = {
  WAREHOUSE: "WAREHOUSE",
  REP_CAR: "REP_CAR",
} as const;

export const STOCK_MOVEMENT_TYPES = {
  PURCHASE_IN: "PURCHASE_IN",
  TRANSFER: "TRANSFER",
  SALE_OUT: "SALE_OUT",
  RETURN_IN: "RETURN_IN",
  ADJUSTMENT: "ADJUSTMENT",
  REP_ASSIGNMENT: "REP_ASSIGNMENT",
  REP_RETURN: "REP_RETURN",
  STOCK_IN: "STOCK_IN",
  STOCK_OUT: "STOCK_OUT",
  ORDER_RESERVED: "ORDER_RESERVED",
  ORDER_RELEASED: "ORDER_RELEASED",
  ORDER_FULFILLED: "ORDER_FULFILLED",
  RETURNED: "RETURNED",
} as const;

/** Subset of STOCK_MOVEMENT_TYPES usable from the Phase 7 manual adjustment
 * form. Other movement types exist as constants for future phases (order
 * stock fulfillment, sales rep stock, etc.) but are not created anywhere yet. */
export const MANUAL_STOCK_MOVEMENT_TYPES = {
  STOCK_IN: "STOCK_IN",
  STOCK_OUT: "STOCK_OUT",
  ADJUSTMENT: "ADJUSTMENT",
} as const;

export const ORDER_STATUSES = {
  PENDING: "PENDING",
  CONFIRMED: "CONFIRMED",
  PREPARING: "PREPARING",
  OUT_FOR_DELIVERY: "OUT_FOR_DELIVERY",
  DELIVERED: "DELIVERED",
  CANCELLED: "CANCELLED",
  RETURNED: "RETURNED",
} as const;

export const ORDER_SOURCES = {
  RETAIL: "RETAIL",
  WHOLESALE: "WHOLESALE",
  REP_SALE: "REP_SALE",
} as const;

export const STOCK_REQUEST_STATUSES = {
  PENDING: "PENDING",
  APPROVED: "APPROVED",
  REJECTED: "REJECTED",
  FULFILLED: "FULFILLED",
} as const;

export const STOCK_RETURN_STATUSES = {
  PENDING: "PENDING",
  APPROVED: "APPROVED",
  REJECTED: "REJECTED",
  COMPLETED: "COMPLETED",
} as const;

export const DEFAULT_CURRENCY = "ILS" as const;

export const PAYMENT_METHODS = {
  CASH_ON_DELIVERY: "CASH_ON_DELIVERY",
  /** Immediate in-person cash sale (e.g. rep direct sale) — distinct from
   * CASH_ON_DELIVERY, which implies payment happens later at delivery. */
  CASH: "CASH",
} as const;

export const PAYMENT_STATUSES = {
  PENDING: "PENDING",
  PAID: "PAID",
  FAILED: "FAILED",
  REFUNDED: "REFUNDED",
} as const;

/** Active products with total on-hand quantity below this are "low stock"
 * on the admin dashboard. */
export const LOW_STOCK_THRESHOLD = 5;

/** Admin dashboard sidebar navigation (skeleton — links are placeholders). */
export const ADMIN_NAV_ITEMS = [
  { label: "Overview", labelAr: "نظرة عامة", href: "/admin" },
  { label: "Products", labelAr: "المنتجات", href: "/admin/products" },
  { label: "Categories", labelAr: "الأقسام", href: "/admin/categories" },
  { label: "Brands", labelAr: "العلامات التجارية", href: "/admin/brands" },
  { label: "Suppliers", labelAr: "الموردون", href: "/admin/suppliers" },
  { label: "Inventory", labelAr: "المخزون", href: "/admin/inventory" },
  { label: "Orders", labelAr: "الطلبات", href: "/admin/orders" },
  { label: "Merchants", labelAr: "التجار", href: "/admin/merchants" },
  { label: "Sales Reps", labelAr: "المندوبون", href: "/admin/reps" },
] as const;
