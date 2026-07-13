import { Badge } from "@/components/ui/Badge";
import { getStockRequestStatusLabel, getStockRequestStatusBadgeVariant } from "@/lib/rep-stock-request-labels";

export function RepStockRequestStatusBadge({ status }: { status: string }) {
  return <Badge variant={getStockRequestStatusBadgeVariant(status)}>{getStockRequestStatusLabel(status)}</Badge>;
}
