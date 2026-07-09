import type {
  ADMIN_NAV_ITEMS,
  MERCHANT_STATUSES,
  ORDER_SOURCES,
  ORDER_STATUSES,
  PAYMENT_METHODS,
  PAYMENT_STATUSES,
  ROLES,
  STOCK_LOCATION_TYPES,
  STOCK_MOVEMENT_TYPES,
  STOCK_REQUEST_STATUSES,
  STOCK_RETURN_STATUSES,
} from "@/lib/constants";

/** Shared TypeScript types for Ovi Mobile, mirroring the string-literal
 * "enum" fields defined in prisma/schema.prisma. */

export type Role = (typeof ROLES)[keyof typeof ROLES];
export type MerchantStatus = (typeof MERCHANT_STATUSES)[keyof typeof MERCHANT_STATUSES];
export type StockLocationType = (typeof STOCK_LOCATION_TYPES)[keyof typeof STOCK_LOCATION_TYPES];
export type StockMovementType = (typeof STOCK_MOVEMENT_TYPES)[keyof typeof STOCK_MOVEMENT_TYPES];
export type OrderStatus = (typeof ORDER_STATUSES)[keyof typeof ORDER_STATUSES];
export type OrderSource = (typeof ORDER_SOURCES)[keyof typeof ORDER_SOURCES];
export type StockRequestStatus = (typeof STOCK_REQUEST_STATUSES)[keyof typeof STOCK_REQUEST_STATUSES];
export type StockReturnStatus = (typeof STOCK_RETURN_STATUSES)[keyof typeof STOCK_RETURN_STATUSES];
export type PaymentMethod = (typeof PAYMENT_METHODS)[keyof typeof PAYMENT_METHODS];
export type PaymentStatus = (typeof PAYMENT_STATUSES)[keyof typeof PAYMENT_STATUSES];

export type AdminNavItem = (typeof ADMIN_NAV_ITEMS)[number];

/** Generic shape for a value stored as smallest-currency-unit Int. */
export interface Money {
  cents: number;
  currency: string;
}
