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
  /** Manual order entered by an admin from the office/warehouse counter —
   * see /admin/orders/new. */
  ADMIN_MANUAL: "ADMIN_MANUAL",
} as const;

/** Rep car-stock restock request lifecycle. Stock only ever mutates on the
 * PENDING -> ... -> COMPLETED transition (see completeStockRequest). */
export const STOCK_REQUEST_STATUSES = {
  PENDING: "PENDING",
  REVIEWED: "REVIEWED",
  PREPARED: "PREPARED",
  COMPLETED: "COMPLETED",
  REJECTED: "REJECTED",
} as const;

export const STOCK_REQUEST_TYPES = {
  /** The only type implemented in Phase 27 — rep asks for stock to be
   * loaded into their car. A RETURN request type is a future-phase idea. */
  RESTOCK: "RESTOCK",
} as const;

export const STOCK_RETURN_STATUSES = {
  PENDING: "PENDING",
  APPROVED: "APPROVED",
  REJECTED: "REJECTED",
  COMPLETED: "COMPLETED",
} as const;

/** Real events actually written today: LOGIN / LOGOUT (see
 * src/lib/auth/session.ts). The rest are modeled and ready for the
 * storefront to start writing, but nothing fabricates them — see the Users
 * admin feature report for why they aren't wired yet. */
export const USER_ACTIVITY_EVENT_TYPES = {
  LOGIN: "LOGIN",
  LOGOUT: "LOGOUT",
  PRODUCT_VIEWED: "PRODUCT_VIEWED",
  ADDED_TO_CART: "ADDED_TO_CART",
  REMOVED_FROM_CART: "REMOVED_FROM_CART",
  CHECKOUT_STARTED: "CHECKOUT_STARTED",
  ORDER_CREATED: "ORDER_CREATED",
  ORDER_CANCELLED: "ORDER_CANCELLED",
  SEARCH_QUERY: "SEARCH_QUERY",
  ADMIN_ACTION: "ADMIN_ACTION",
} as const;

export const ADMIN_AUDIT_ACTIONS = {
  ROLE_CHANGED: "ROLE_CHANGED",
  ACCOUNT_DISABLED: "ACCOUNT_DISABLED",
  ACCOUNT_ENABLED: "ACCOUNT_ENABLED",
  MERCHANT_APPROVED: "MERCHANT_APPROVED",
  MERCHANT_REJECTED: "MERCHANT_REJECTED",
  MERCHANT_SUSPENDED: "MERCHANT_SUSPENDED",
  MERCHANT_STATUS_RESET: "MERCHANT_STATUS_RESET",
} as const;

/** Derived from User.passwordHash: Google-authenticated accounts are always
 * created with passwordHash: null (see src/app/auth/google/callback/route.ts) —
 * no separate column needed to know how a user registered. */
export const REGISTRATION_METHODS = {
  GOOGLE: "GOOGLE",
  EMAIL_PASSWORD: "EMAIL_PASSWORD",
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
  /** Some but not all of the total has been received — see
   * Order.paidAmountCents. */
  PARTIAL: "PARTIAL",
  PAID: "PAID",
  FAILED: "FAILED",
  REFUNDED: "REFUNDED",
} as const;

/** Active products with total on-hand quantity below this are "low stock"
 * on the admin dashboard. */
export const LOW_STOCK_THRESHOLD = 5;

/** Products created within this window may truthfully be labeled as new. */
export const NEW_PRODUCT_DAYS = 14;

/** Admin dashboard sidebar navigation (skeleton — links are placeholders). */
export const ADMIN_NAV_ITEMS = [
  { label: "Overview", labelAr: "نظرة عامة", href: "/admin" },
  { label: "Products", labelAr: "المنتجات", href: "/admin/products" },
  { label: "Categories", labelAr: "الأقسام", href: "/admin/categories" },
  { label: "Brands", labelAr: "العلامات التجارية", href: "/admin/brands" },
  { label: "Suppliers", labelAr: "الموردون", href: "/admin/suppliers" },
  { label: "Inventory", labelAr: "المخزون", href: "/admin/inventory" },
  { label: "Orders", labelAr: "الطلبات", href: "/admin/orders" },
  { label: "Users", labelAr: "المستخدمون", href: "/admin/users" },
  { label: "Merchants", labelAr: "التجار", href: "/admin/merchants" },
  { label: "Sales Reps", labelAr: "المندوبون", href: "/admin/reps" },
  { label: "Car Stock Requests", labelAr: "طلبات السيارة", href: "/admin/rep-requests" },
] as const;
