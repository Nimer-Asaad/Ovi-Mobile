import { ORDER_STATUSES, ORDER_SOURCES, PAYMENT_METHODS, PAYMENT_STATUSES } from "@/lib/constants";
import type { BadgeVariant } from "@/components/ui/Badge";

/**
 * Centralized Arabic labels for order-related string fields, shared by the
 * customer-facing /orders pages and the admin /admin/orders pages so a
 * status rename only has to happen in one place.
 *
 * Every lookup falls back to the raw value itself (never crashes, never
 * hides the row) so an old/legacy/unexpected value — e.g. data seeded
 * before a status rename, or a future source like REP_SALE — still renders
 * something readable instead of breaking the page.
 */

const ORDER_STATUS_LABELS: Record<string, string> = {
  [ORDER_STATUSES.PENDING]: "قيد الانتظار",
  [ORDER_STATUSES.CONFIRMED]: "مؤكد",
  [ORDER_STATUSES.PREPARING]: "قيد التجهيز",
  [ORDER_STATUSES.OUT_FOR_DELIVERY]: "قيد التوصيل",
  [ORDER_STATUSES.DELIVERED]: "تم التوصيل",
  [ORDER_STATUSES.CANCELLED]: "ملغي",
  [ORDER_STATUSES.RETURNED]: "مرتجع",
};

const PAYMENT_STATUS_LABELS: Record<string, string> = {
  [PAYMENT_STATUSES.PENDING]: "قيد الانتظار",
  [PAYMENT_STATUSES.PAID]: "مدفوع",
  [PAYMENT_STATUSES.FAILED]: "فشل الدفع",
  [PAYMENT_STATUSES.REFUNDED]: "مسترجع",
};

const PAYMENT_METHOD_LABELS: Record<string, string> = {
  [PAYMENT_METHODS.CASH_ON_DELIVERY]: "الدفع عند الاستلام",
  [PAYMENT_METHODS.CASH]: "نقداً",
};

const ORDER_SOURCE_LABELS: Record<string, string> = {
  [ORDER_SOURCES.RETAIL]: "عميل تجزئة",
  [ORDER_SOURCES.WHOLESALE]: "تاجر جملة",
  [ORDER_SOURCES.REP_SALE]: "مبيعات مندوب",
};

export function getOrderStatusLabel(status: string): string {
  return ORDER_STATUS_LABELS[status] ?? status;
}

export function getPaymentStatusLabel(status: string): string {
  return PAYMENT_STATUS_LABELS[status] ?? status;
}

export function getPaymentMethodLabel(method: string): string {
  return PAYMENT_METHOD_LABELS[method] ?? method;
}

export function getOrderSourceLabel(source: string): string {
  return ORDER_SOURCE_LABELS[source] ?? source;
}

export function getOrderStatusBadgeVariant(status: string): BadgeVariant {
  switch (status) {
    case ORDER_STATUSES.DELIVERED:
      return "success";
    case ORDER_STATUSES.CANCELLED:
    case ORDER_STATUSES.RETURNED:
      return "danger";
    case ORDER_STATUSES.PENDING:
      return "warning";
    case ORDER_STATUSES.CONFIRMED:
    case ORDER_STATUSES.PREPARING:
    case ORDER_STATUSES.OUT_FOR_DELIVERY:
      return "gold";
    default:
      return "neutral";
  }
}

export function getPaymentStatusBadgeVariant(status: string): BadgeVariant {
  switch (status) {
    case PAYMENT_STATUSES.PAID:
      return "success";
    case PAYMENT_STATUSES.FAILED:
      return "danger";
    case PAYMENT_STATUSES.REFUNDED:
      return "neutral";
    case PAYMENT_STATUSES.PENDING:
    default:
      return "warning";
  }
}
