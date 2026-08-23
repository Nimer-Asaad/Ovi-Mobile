import { REP_CUSTOMER_ORDER_STATUSES } from "@/lib/constants";
import type { BadgeVariant } from "@/components/ui/Badge";

const STATUS_LABELS: Record<string, string> = {
  [REP_CUSTOMER_ORDER_STATUSES.OPEN]: "نشط",
  [REP_CUSTOMER_ORDER_STATUSES.COMPLETED]: "مكتمل",
  [REP_CUSTOMER_ORDER_STATUSES.CANCELLED]: "ملغى",
};

export function getRepCustomerOrderStatusLabel(status: string): string {
  return STATUS_LABELS[status] ?? status;
}

export function getRepCustomerOrderStatusBadgeVariant(status: string): BadgeVariant {
  switch (status) {
    case REP_CUSTOMER_ORDER_STATUSES.COMPLETED:
      return "success";
    case REP_CUSTOMER_ORDER_STATUSES.CANCELLED:
      return "danger";
    case REP_CUSTOMER_ORDER_STATUSES.OPEN:
    default:
      return "gold";
  }
}
