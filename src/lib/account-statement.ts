import { isTerminalOrderStatus } from "@/lib/order-lifecycle-rules";
import { getOrderStatusLabel } from "@/lib/order-labels";
import { getAccountPaymentMethodLabel } from "@/lib/account-labels";

export interface AccountStatementOrderInput {
  orderNumber: string;
  createdAt: Date;
  status: string;
  totalCents: number;
  /** Name of the sales rep who made this sale (Order.createdByRepId ->
   * SalesRepresentative.user.name) — null for a non-rep order (retail/
   * wholesale checkout, admin manual order with no rep attached). */
  repName?: string | null;
}

export interface AccountStatementPaymentInput {
  id: string;
  amountCents: number;
  method: string;
  createdAt: Date;
  note: string | null;
  /** Name of whoever actually recorded/collected this payment
   * (AccountPayment.createdById -> User.name) — an admin or a sales rep,
   * whichever authenticated user actually submitted it. */
  collectedByName?: string | null;
}

export type AccountStatementRowType = "OPENING" | "SALE" | "PAYMENT";

export interface AccountStatementRow {
  key: string;
  /** Null only for the OPENING row when openingBalanceSetAt itself is
   * somehow null despite a positive opening balance (shouldn't happen in
   * practice — see setAccountOpeningBalance, which always sets both
   * together — but never crashes on it either). Always a real Date for
   * every SALE/PAYMENT row. */
  date: Date | null;
  type: AccountStatementRowType;
  /** Order number for a SALE row, the payment's own id for a PAYMENT row,
   * the literal string "OPENING" for the opening-balance row — a stable,
   * human-checkable reference for the row, never fabricated to look like a
   * real order. */
  reference: string;
  description: string;
  /** مدين — increases the amount owed: the opening balance itself, or an
   * active order's total. Zero for a cancelled/returned order (see
   * isTerminalOrderStatus) and for every PAYMENT row. */
  debitCents: number;
  /** دائن — decreases the amount owed (a payment). Zero for the OPENING row
   * and every SALE row. */
  creditCents: number;
  /** Running balance immediately after this row, in display order — the
   * OPENING row (always first, regardless of when it was actually entered)
   * starts the running total at openingBalanceCents; the final row's value
   * always equals getAccountBalanceCents(...) exactly, since both apply the
   * identical formula (opening + non-terminal orders - payments). */
  balanceCents: number;
  /** True only for a cancelled/returned SALE row — shown, never hidden (the
   * order still happened), but visually de-emphasized and contributing
   * nothing to debit/balance. Always false for OPENING/PAYMENT rows. */
  isTerminalOrder: boolean;
}

export interface AccountStatementInput {
  /** CustomerAccount.openingBalanceCents — required (not optional/defaulted
   * here) so every caller is forced to actually select and pass it, the
   * same guarantee getAccountBalanceCents's own required field provides. */
  openingBalanceCents: number;
  /** CustomerAccount.openingBalanceSetAt — shown as the OPENING row's date
   * when present; required as a key (value may be null) so a caller can
   * never simply forget to select it once fetching more fields later. */
  openingBalanceSetAt: Date | null;
  orders: AccountStatementOrderInput[];
  payments: AccountStatementPaymentInput[];
}

/** Builds the unified, chronological ledger (سجل موحّد) a merchant statement
 * shows — an OPENING row (only when openingBalanceCents > 0, always first
 * regardless of its own timestamp — it represents pre-system history, not a
 * transaction that happened on any particular day), then one row per order
 * AND one row per payment, interleaved by date, each carrying a running
 * balance. This is a pure, deterministic transformation of the exact same
 * openingBalanceCents/orders/payments getAccountBalanceCents already reads
 * (src/lib/accounts.ts) — the final row's balanceCents always equals
 * getAccountBalanceCents(input) exactly. Never a second, competing balance
 * calculation. */
export function buildAccountStatementRows(input: AccountStatementInput): AccountStatementRow[] {
  interface RawRow {
    date: Date;
    type: "SALE" | "PAYMENT";
    reference: string;
    description: string;
    debitCents: number;
    creditCents: number;
    isTerminalOrder: boolean;
    /** Deterministic tie-break for identical timestamps — orders sort
     * before payments at the exact same instant, then by reference. */
    sortTieBreak: string;
  }

  const raw: RawRow[] = [];

  for (const order of input.orders) {
    const terminal = isTerminalOrderStatus(order.status);
    const descriptionParts = [
      `طلب رقم ${order.orderNumber}`,
      order.repName ? `— المندوب: ${order.repName}` : null,
      terminal ? `(${getOrderStatusLabel(order.status)} — غير محتسب في الرصيد)` : null,
    ].filter((part): part is string => Boolean(part));

    raw.push({
      date: order.createdAt,
      type: "SALE",
      reference: order.orderNumber,
      description: descriptionParts.join(" "),
      debitCents: terminal ? 0 : order.totalCents,
      creditCents: 0,
      isTerminalOrder: terminal,
      sortTieBreak: `0:${order.orderNumber}`,
    });
  }

  for (const payment of input.payments) {
    const descriptionParts = [
      `دفعة (${getAccountPaymentMethodLabel(payment.method)})`,
      payment.collectedByName ? `— استلمها: ${payment.collectedByName}` : null,
      payment.note ? `— ${payment.note}` : null,
    ].filter((part): part is string => Boolean(part));

    raw.push({
      date: payment.createdAt,
      type: "PAYMENT",
      reference: payment.id,
      description: descriptionParts.join(" "),
      debitCents: 0,
      creditCents: payment.amountCents,
      isTerminalOrder: false,
      sortTieBreak: `1:${payment.id}`,
    });
  }

  raw.sort((a, b) => {
    const diff = a.date.getTime() - b.date.getTime();
    if (diff !== 0) return diff;
    return a.sortTieBreak.localeCompare(b.sortTieBreak);
  });

  const rows: AccountStatementRow[] = [];
  let runningBalanceCents = 0;

  // OPENING row — deliberately NOT part of the chronological sort above:
  // it always renders first, no matter what openingBalanceSetAt says,
  // because it represents debt that predates every order/payment this
  // system ever recorded, not an event that happened "on" that date.
  if (input.openingBalanceCents > 0) {
    runningBalanceCents += input.openingBalanceCents;
    rows.push({
      key: "OPENING",
      date: input.openingBalanceSetAt,
      type: "OPENING",
      reference: "OPENING",
      description: "رصيد افتتاحي — مديونية سابقة قبل استخدام النظام",
      debitCents: input.openingBalanceCents,
      creditCents: 0,
      balanceCents: runningBalanceCents,
      isTerminalOrder: false,
    });
  }

  raw.forEach((row, index) => {
    runningBalanceCents += row.debitCents - row.creditCents;
    rows.push({
      key: `${row.type}:${row.reference}:${index}`,
      date: row.date,
      type: row.type,
      reference: row.reference,
      description: row.description,
      debitCents: row.debitCents,
      creditCents: row.creditCents,
      balanceCents: runningBalanceCents,
      isTerminalOrder: row.isTerminalOrder,
    });
  });

  return rows;
}
