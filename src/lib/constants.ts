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
} as const;

export const ORDER_STATUSES = {
  PENDING: "PENDING",
  CONFIRMED: "CONFIRMED",
  PROCESSING: "PROCESSING",
  SHIPPED: "SHIPPED",
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
  { label: "Sales Reps", labelAr: "المندوبون", href: "/admin/sales-reps" },
  { label: "Finance", labelAr: "المالية", href: "/admin/finance" },
  { label: "Users", labelAr: "المستخدمون", href: "/admin/users" },
] as const;
