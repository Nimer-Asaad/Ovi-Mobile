import { MERCHANT_STATUSES } from "@/lib/constants";
import type { BadgeVariant } from "@/components/ui/Badge";

const MERCHANT_STATUS_LABELS: Record<string, string> = {
  [MERCHANT_STATUSES.PENDING]: "قيد المراجعة",
  [MERCHANT_STATUSES.APPROVED]: "معتمد",
  [MERCHANT_STATUSES.REJECTED]: "مرفوض",
  [MERCHANT_STATUSES.SUSPENDED]: "موقوف",
};

export function getMerchantStatusLabel(status: string): string {
  return MERCHANT_STATUS_LABELS[status] ?? status;
}

export function getMerchantStatusBadgeVariant(status: string): BadgeVariant {
  switch (status) {
    case MERCHANT_STATUSES.APPROVED:
      return "success";
    case MERCHANT_STATUSES.REJECTED:
    case MERCHANT_STATUSES.SUSPENDED:
      return "danger";
    case MERCHANT_STATUSES.PENDING:
    default:
      return "warning";
  }
}
