import { STOCK_MOVEMENT_TYPES } from "@/lib/constants";
import type { BadgeVariant } from "@/components/ui/Badge";

const MOVEMENT_TYPE_LABELS: Record<string, string> = {
  [STOCK_MOVEMENT_TYPES.STOCK_IN]: "إدخال مخزون",
  [STOCK_MOVEMENT_TYPES.STOCK_OUT]: "إخراج مخزون",
  [STOCK_MOVEMENT_TYPES.ADJUSTMENT]: "تعديل مخزون",
  [STOCK_MOVEMENT_TYPES.PURCHASE_IN]: "شراء وارد",
  [STOCK_MOVEMENT_TYPES.TRANSFER]: "نقل",
  [STOCK_MOVEMENT_TYPES.SALE_OUT]: "بيع صادر",
  [STOCK_MOVEMENT_TYPES.RETURN_IN]: "إرجاع وارد",
  [STOCK_MOVEMENT_TYPES.REP_ASSIGNMENT]: "تحميل إلى السيارة",
  [STOCK_MOVEMENT_TYPES.REP_RETURN]: "إرجاع إلى المستودع",
  [STOCK_MOVEMENT_TYPES.ORDER_RESERVED]: "محجوز لطلب",
  [STOCK_MOVEMENT_TYPES.ORDER_RELEASED]: "إفراج عن حجز",
  [STOCK_MOVEMENT_TYPES.ORDER_FULFILLED]: "تنفيذ طلب",
  [STOCK_MOVEMENT_TYPES.RETURNED]: "مرتجع",
};

export function getMovementTypeLabel(type: string): string {
  return MOVEMENT_TYPE_LABELS[type] ?? type;
}

export function getMovementTypeBadgeVariant(type: string): BadgeVariant {
  switch (type) {
    case STOCK_MOVEMENT_TYPES.STOCK_IN:
    case STOCK_MOVEMENT_TYPES.PURCHASE_IN:
    case STOCK_MOVEMENT_TYPES.RETURN_IN:
    case STOCK_MOVEMENT_TYPES.REP_ASSIGNMENT:
      return "success";
    case STOCK_MOVEMENT_TYPES.STOCK_OUT:
    case STOCK_MOVEMENT_TYPES.SALE_OUT:
      return "danger";
    case STOCK_MOVEMENT_TYPES.ADJUSTMENT:
    case STOCK_MOVEMENT_TYPES.REP_RETURN:
      return "warning";
    case STOCK_MOVEMENT_TYPES.TRANSFER:
      return "gold";
    default:
      return "neutral";
  }
}
