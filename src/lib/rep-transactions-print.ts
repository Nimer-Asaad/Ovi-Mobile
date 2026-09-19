import "server-only";
import { prisma } from "@/lib/prisma";
import { getOrderAccountPosition, getPaymentAccountPosition } from "@/lib/accounts";
import { getOrderStatusHistoryBusinessCreatedAt, getPaymentCancellationBusinessCancelledAt } from "@/lib/business-time";
import { isTerminalOrderStatus } from "@/lib/order-lifecycle-rules";
import { getOrderIdsInRange, getPaymentIdsInRange } from "@/lib/reporting";
import type { InvoiceData } from "@/components/admin/orders/InvoiceView";
import type { PaymentReceiptData } from "@/components/shared/PaymentReceiptView";

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** Strict YYYY-MM-DD check including real-calendar validity (rejects 2026-02-31). */
function isValidIsoDate(value: string | undefined): value is string {
  if (!value) return false;
  const match = ISO_DATE.exec(value);
  if (!match) return false;
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

export type RepPrintRangeResult = { ok: true; fromIso: string; toIso: string } | { ok: false; error: string };

export function parseRepPrintRange(from: string | undefined, to: string | undefined): RepPrintRangeResult {
  if (!isValidIsoDate(from) || !isValidIsoDate(to)) return { ok: false, error: "تاريخ غير صالح. الرجاء اختيار تاريخين صحيحين." };
  if (from > to) return { ok: false, error: "تاريخ البداية يجب أن يكون قبل أو يساوي تاريخ النهاية." };
  return { ok: true, fromIso: from, toIso: to };
}

export type RepPrintTransaction =
  | { type: "SALE"; key: string; at: Date; invoice: InvoiceData }
  | { type: "PAYMENT"; key: string; at: Date; receipt: PaymentReceiptData };

export interface RepPrintTotals {
  salesCount: number;
  salesTotalCents: number;
  paymentsCount: number;
  paymentsTotalCents: number;
}

const ACCOUNT_SELECT = {
  displayName: true,
  phone: true,
  openingBalanceCents: true,
  openingBalanceSetAt: true,
  orders: { select: { orderNumber: true, createdAt: true, status: true, totalCents: true } },
  payments: {
    select: {
      id: true,
      createdAt: true,
      amountCents: true,
      method: true,
      note: true,
      cancellation: { select: { reason: true, cancelledAt: true, cancelledBy: { select: { name: true } } } },
    },
  },
} as const;

const MERCHANT_SELECT = {
  businessName: true,
  contactName: true,
  contactPhone: true,
  whatsappPhone: true,
  city: true,
  region: true,
} as const;

/** Read-only. Sales = orders whose createdByRepId is this rep; payments =
 * account_payments whose createdById is this rep's User id (the actual
 * collector — never a merchant's assignedRepId). Both windows use the
 * existing inclusive Palestine business-date SQL helpers from reporting.ts,
 * and every row is rendered from the same data the standalone invoice/
 * receipt pages use. Oldest first. */
export async function loadRepTransactions(rep: { id: string; userId: string }, fromIso: string, toIso: string) {
  const [orderIdRows, paymentIdRows] = await Promise.all([
    getOrderIdsInRange(fromIso, toIso, rep.id),
    getPaymentIdsInRange(fromIso, toIso, rep.userId),
  ]);
  const orderBusinessAt = new Map(orderIdRows.map((row) => [row.id, row.businessCreatedAt]));
  const paymentBusinessAt = new Map(paymentIdRows.map((row) => [row.id, row.businessCreatedAt]));

  const [orders, payments] = await Promise.all([
    orderIdRows.length === 0
      ? []
      : prisma.order.findMany({
          where: { id: { in: orderIdRows.map((row) => row.id) } },
          select: {
            id: true,
            orderNumber: true,
            createdAt: true,
            status: true,
            statusHistory: {
              orderBy: { createdAt: "desc" },
              take: 1,
              select: { id: true, reason: true, changedBy: { select: { name: true } } },
            },
            source: true,
            paymentMethod: true,
            paymentStatus: true,
            subtotalCents: true,
            discountCents: true,
            totalCents: true,
            paidAmountCents: true,
            contactName: true,
            contactPhone: true,
            city: true,
            shippingAddress: true,
            notes: true,
            customer: { select: { name: true, email: true } },
            merchant: { select: MERCHANT_SELECT },
            createdByRep: { select: { user: { select: { name: true } } } },
            account: { select: ACCOUNT_SELECT },
            items: {
              select: {
                id: true,
                quantity: true,
                unitPriceCents: true,
                bonusQuantity: true,
                totalCents: true,
                color: { select: { name: true, nameAr: true } },
                phoneBrandSnapshot: true,
                phoneModelSnapshot: true,
                colorNameSnapshot: true,
                variantCodeSnapshot: true,
                product: { select: { sku: true, name: true, nameAr: true } },
              },
            },
          },
        }),
    paymentIdRows.length === 0
      ? []
      : prisma.accountPayment.findMany({
          where: { id: { in: paymentIdRows.map((row) => row.id) } },
          select: {
            id: true,
            receiptNumber: true,
            amountCents: true,
            method: true,
            note: true,
            createdAt: true,
            createdBy: { select: { name: true } },
            cancellation: { select: { reason: true, cancelledAt: true, cancelledBy: { select: { name: true } } } },
            account: { select: { ...ACCOUNT_SELECT, merchant: { select: MERCHANT_SELECT } } },
          },
        }),
  ]);

  const transactions: RepPrintTransaction[] = [];
  const totals: RepPrintTotals = { salesCount: 0, salesTotalCents: 0, paymentsCount: 0, paymentsTotalCents: 0 };

  for (const order of orders) {
    const businessCreatedAt = orderBusinessAt.get(order.id) ?? order.createdAt;
    const latestHistory = order.statusHistory[0] ?? null;
    const cancellation =
      isTerminalOrderStatus(order.status) && latestHistory && latestHistory.reason
        ? {
            reason: latestHistory.reason,
            changedByName: latestHistory.changedBy.name,
            businessChangedAt: (await getOrderStatusHistoryBusinessCreatedAt(latestHistory.id)) ?? businessCreatedAt,
          }
        : null;

    const invoice: InvoiceData = {
      orderNumber: order.orderNumber,
      businessCreatedAt,
      status: order.status,
      cancellation,
      source: order.source,
      paymentMethod: order.paymentMethod,
      paymentStatus: order.paymentStatus,
      subtotalCents: order.subtotalCents,
      discountCents: order.discountCents,
      totalCents: order.totalCents,
      paidAmountCents: order.paidAmountCents,
      contactName: order.contactName,
      contactPhone: order.contactPhone,
      city: order.city,
      shippingAddress: order.shippingAddress,
      notes: order.notes,
      customer: order.customer,
      merchant: order.merchant,
      repName: order.createdByRep?.user.name ?? null,
      account: order.account ? getOrderAccountPosition(order.account, order) : null,
      items: order.items,
    };
    transactions.push({ type: "SALE", key: `sale:${order.orderNumber}`, at: businessCreatedAt, invoice });

    // Same active-only convention as computeActivityTotals in reporting.ts.
    if (!isTerminalOrderStatus(order.status)) {
      totals.salesCount += 1;
      totals.salesTotalCents += order.totalCents;
    }
  }

  for (const payment of payments) {
    const businessCreatedAt = paymentBusinessAt.get(payment.id) ?? payment.createdAt;
    const receipt: PaymentReceiptData = {
      id: payment.id,
      receiptNumber: payment.receiptNumber,
      createdAt: payment.createdAt,
      businessCreatedAt,
      amountCents: payment.amountCents,
      method: payment.method,
      note: payment.note,
      collectedByName: payment.createdBy.name,
      merchant: payment.account.merchant,
      accountDisplayName: payment.account.displayName,
      accountPhone: payment.account.phone,
      account: getPaymentAccountPosition(payment.account, payment),
      cancellation: payment.cancellation
        ? {
            reason: payment.cancellation.reason,
            cancelledByName: payment.cancellation.cancelledBy.name,
            cancelledAt: (await getPaymentCancellationBusinessCancelledAt(payment.id)) ?? payment.cancellation.cancelledAt,
          }
        : null,
    };
    transactions.push({ type: "PAYMENT", key: `payment:${payment.id}`, at: businessCreatedAt, receipt });

    if (!payment.cancellation) {
      totals.paymentsCount += 1;
      totals.paymentsTotalCents += payment.amountCents;
    }
  }

  // Oldest first; identical instants fall back to the stable document key (sale:<orderNumber> / payment:<id>).
  transactions.sort((a, b) => a.at.getTime() - b.at.getTime() || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
  return { transactions, totals };
}
