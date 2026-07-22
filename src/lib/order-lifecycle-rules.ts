import { ORDER_SOURCES, ORDER_STATUSES } from "@/lib/constants";
import type { OrderStatus } from "@/types";

const STANDARD_TRANSITIONS: Record<OrderStatus, readonly OrderStatus[]> = {
  [ORDER_STATUSES.PENDING]: [ORDER_STATUSES.CONFIRMED, ORDER_STATUSES.CANCELLED],
  [ORDER_STATUSES.CONFIRMED]: [ORDER_STATUSES.PREPARING, ORDER_STATUSES.CANCELLED],
  [ORDER_STATUSES.PREPARING]: [ORDER_STATUSES.OUT_FOR_DELIVERY, ORDER_STATUSES.CANCELLED],
  [ORDER_STATUSES.OUT_FOR_DELIVERY]: [ORDER_STATUSES.DELIVERED, ORDER_STATUSES.CANCELLED],
  [ORDER_STATUSES.DELIVERED]: [ORDER_STATUSES.RETURNED],
  [ORDER_STATUSES.CANCELLED]: [],
  [ORDER_STATUSES.RETURNED]: [],
};

export function isTerminalOrderStatus(status: string): boolean {
  return status === ORDER_STATUSES.CANCELLED || status === ORDER_STATUSES.RETURNED;
}

export function transitionRestoresInventory(status: string): boolean {
  return status === ORDER_STATUSES.CANCELLED || status === ORDER_STATUSES.RETURNED;
}

export function getValidNextOrderStatuses(currentStatus: string, source: string): OrderStatus[] {
  if (source === ORDER_SOURCES.REP_SALE) {
    return currentStatus === ORDER_STATUSES.DELIVERED ? [ORDER_STATUSES.RETURNED] : [];
  }
  return [...(STANDARD_TRANSITIONS[currentStatus as OrderStatus] ?? [])];
}
