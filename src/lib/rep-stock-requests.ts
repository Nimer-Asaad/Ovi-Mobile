import "server-only";
import { prisma } from "@/lib/prisma";
import { STOCK_REQUEST_STATUSES } from "@/lib/constants";

const TERMINAL_STATUSES: string[] = [STOCK_REQUEST_STATUSES.COMPLETED, STOCK_REQUEST_STATUSES.REJECTED];

/** Friendly business number shown to reps/admin instead of the raw cuid —
 * see prisma/schema.prisma StockRequest.requestNumber. Collisions are
 * handled by the caller retrying on Prisma's unique-constraint error, same
 * pattern as generateOrderNumber() in the order/rep-sale actions. */
export function generateRequestNumber(): string {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  const random = Math.floor(1000 + Math.random() * 9000);
  return `RSR-${y}${m}${d}-${random}`;
}

/** Count of a rep's requests still awaiting admin action (not yet
 * COMPLETED or REJECTED) — used for the "pending requests" stat on both
 * the admin rep detail page and the rep's own dashboard. */
export async function getActiveRequestCountForRep(salesRepId: string): Promise<number> {
  return prisma.stockRequest.count({
    where: { salesRepId, status: { notIn: TERMINAL_STATUSES } },
  });
}

export interface RepStockRequestSummary {
  id: string;
  requestNumber: string | null;
  status: string;
  createdAt: Date;
  itemCount: number;
}

export async function getLatestRequestsForRep(salesRepId: string, take = 5): Promise<RepStockRequestSummary[]> {
  const requests = await prisma.stockRequest.findMany({
    where: { salesRepId },
    orderBy: { createdAt: "desc" },
    take,
    select: {
      id: true,
      requestNumber: true,
      status: true,
      createdAt: true,
      items: { select: { id: true } },
    },
  });

  return requests.map((request) => ({
    id: request.id,
    requestNumber: request.requestNumber,
    status: request.status,
    createdAt: request.createdAt,
    itemCount: request.items.length,
  }));
}
