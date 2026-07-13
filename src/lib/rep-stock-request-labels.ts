import { STOCK_REQUEST_STATUSES } from "@/lib/constants";
import type { BadgeVariant } from "@/components/ui/Badge";

const STATUS_LABELS: Record<string, string> = {
  [STOCK_REQUEST_STATUSES.PENDING]: "قيد المراجعة",
  [STOCK_REQUEST_STATUSES.REVIEWED]: "تمت المراجعة",
  [STOCK_REQUEST_STATUSES.PREPARED]: "جاهز للتسليم",
  [STOCK_REQUEST_STATUSES.COMPLETED]: "مكتمل / تم الاستلام",
  [STOCK_REQUEST_STATUSES.REJECTED]: "مرفوض",
};

export function getStockRequestStatusLabel(status: string): string {
  return STATUS_LABELS[status] ?? status;
}

export function getStockRequestStatusBadgeVariant(status: string): BadgeVariant {
  switch (status) {
    case STOCK_REQUEST_STATUSES.COMPLETED:
      return "success";
    case STOCK_REQUEST_STATUSES.PREPARED:
      return "gold";
    case STOCK_REQUEST_STATUSES.REVIEWED:
      return "neutral";
    case STOCK_REQUEST_STATUSES.REJECTED:
      return "danger";
    case STOCK_REQUEST_STATUSES.PENDING:
    default:
      return "warning";
  }
}

/** Per-line state derived from approvedQuantity — never stored separately.
 * null = admin hasn't reviewed this line yet; 0 = rejected/removed;
 * >0 = approved (fully or partially). */
export function getRequestLineStateLabel(requestedQuantity: number, approvedQuantity: number | null): string {
  if (approvedQuantity === null) return "بانتظار المراجعة";
  if (approvedQuantity === 0) return "مرفوض";
  if (approvedQuantity < requestedQuantity) return "موافق عليه جزئياً";
  return "موافق عليه بالكامل";
}

export function getRequestLineStateBadgeVariant(
  requestedQuantity: number,
  approvedQuantity: number | null,
): BadgeVariant {
  if (approvedQuantity === null) return "warning";
  if (approvedQuantity === 0) return "danger";
  if (approvedQuantity < requestedQuantity) return "gold";
  return "success";
}
