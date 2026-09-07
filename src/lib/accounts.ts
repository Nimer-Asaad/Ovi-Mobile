import "server-only";
import { Prisma } from "@prisma/client";
import { isTerminalOrderStatus } from "@/lib/order-lifecycle-rules";
import { ACCOUNT_PAYMENT_METHODS, ACCOUNT_PAYMENT_ORIGINS } from "@/lib/constants";
import { generateDailyPaymentReceiptNumber } from "@/lib/payment-number";
import {
  buildAccountStatementRows,
  type AccountStatementOrderInput,
  type AccountStatementPaymentInput,
} from "@/lib/account-statement";

type Tx = Prisma.TransactionClient;

/** Finds or lazily creates the ledger account for an approved merchant,
 * keyed on Merchant.id (CustomerAccount.merchantId is @unique). Must run
 * inside the caller's own transaction so a concurrent checkout/manual-order
 * creating the same merchant's account for the first time can't produce two
 * rows — the P2002 race is caught and resolved by re-reading, the same
 * pattern resolveConcurrentCompensation uses in order-lifecycle.ts. */
export async function getOrCreateMerchantAccount(tx: Tx, merchantId: string): Promise<string> {
  const existing = await tx.customerAccount.findUnique({
    where: { merchantId },
    select: { id: true },
  });
  if (existing) return existing.id;

  const merchant = await tx.merchant.findUniqueOrThrow({
    where: { id: merchantId },
    select: { businessName: true, contactPhone: true, user: { select: { phone: true } } },
  });

  try {
    const created = await tx.customerAccount.create({
      data: { displayName: merchant.businessName, phone: merchant.contactPhone ?? merchant.user?.phone, merchantId },
      select: { id: true },
    });
    return created.id;
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      const raced = await tx.customerAccount.findUniqueOrThrow({
        where: { merchantId },
        select: { id: true },
      });
      return raced.id;
    }
    throw error;
  }
}

/** Same lazy get-or-create pattern as getOrCreateMerchantAccount, keyed on
 * User.id (CustomerAccount.customerId is @unique) for a registered retail
 * customer opted into debt tracking on a manual order. */
export async function getOrCreateCustomerAccount(tx: Tx, customerId: string): Promise<string> {
  const existing = await tx.customerAccount.findUnique({
    where: { customerId },
    select: { id: true },
  });
  if (existing) return existing.id;

  const customer = await tx.user.findUniqueOrThrow({
    where: { id: customerId },
    select: { name: true, phone: true },
  });

  try {
    const created = await tx.customerAccount.create({
      data: { displayName: customer.name, phone: customer.phone, customerId },
      select: { id: true },
    });
    return created.id;
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      const raced = await tx.customerAccount.findUniqueOrThrow({
        where: { customerId },
        select: { id: true },
      });
      return raced.id;
    }
    throw error;
  }
}

/** Read-only counterpart to getOrCreateCustomerAccount — attaches an order
 * to a customer's account if one already exists, but never creates one.
 * Used by checkout (src/app/checkout/actions.ts) for every authenticated
 * order, not just wholesale: most ordinary retail customers have no
 * account and should stay that way, but a customer the admin has
 * explicitly set up with an account (e.g. via the walk-in "create a login
 * too" flow) should have every purchase — app or office — roll into the
 * same ledger, not just the ones placed manually by an admin. */
export async function getExistingCustomerAccountId(tx: Tx, customerId: string): Promise<string | undefined> {
  const existing = await tx.customerAccount.findUnique({
    where: { customerId },
    select: { id: true },
  });
  return existing?.id;
}

/** Mirrors an order's up-front paidAmountCents into the ledger as the
 * account's first payment entry — without this, a tracked order that was
 * partially or fully paid at creation time would overstate the account's
 * balance by exactly that amount. Callers only invoke this when
 * paidAmountCents > 0, in the same transaction as the order creation.
 * `options.method`/`options.note` default to the original CASH/generic-note
 * values so every existing caller keeps behaving exactly as before; a caller
 * that knows the trader's actual payment method and wants a traceable note
 * (e.g. a rep sale's "paid now" amount — see createRepSaleCore) can pass
 * both explicitly. Note is purely descriptive, never relied on for
 * accounting — the balance is always openingBalanceCents + orders -
 * payments (see getAccountBalanceCents), never derived from note text.
 *
 * Always assigns a persisted receiptNumber (see generateDailyPaymentReceiptNumber
 * in src/lib/payment-number.ts) — this sale-linked payment is still a real
 * row in the one canonical AccountPayment table, so it gets a سند قبض number
 * exactly like a standalone manual payment does, even though the caller's
 * own post-sale redirect deliberately keeps going to the sale invoice, never
 * this payment's own receipt page (see createRepSaleCore /
 * admin/orders/new/actions.ts — unchanged by this). Generated with THIS
 * SAME `tx` — never a nested transaction — and always called after that
 * sale's own generateDailyOrderNumber, so lock acquisition order across the
 * two modules stays consistently Order-lock-then-Payment-lock everywhere,
 * never reversed in one path — see payment-number.ts's own doc comment for
 * why that ordering consistency matters. */
export async function recordInitialAccountPayment(
  tx: Tx,
  accountId: string,
  amountCents: number,
  createdById: string,
  /** The Order this payment is the "paid now" portion of — written into
   * AccountPayment.sourceOrderId (with origin = SALE_INITIAL) so the sale
   * correction workflow (src/lib/sale-correction.ts) can later find this
   * exact payment through a real persisted relation, never by parsing
   * `note`. Required: every call to this function is, by definition,
   * recording a sale's own initial payment. */
  orderId: string,
  options?: { method?: string; note?: string },
): Promise<void> {
  const receiptNumber = await generateDailyPaymentReceiptNumber(tx);
  await tx.accountPayment.create({
    data: {
      accountId,
      amountCents,
      method: options?.method ?? ACCOUNT_PAYMENT_METHODS.CASH,
      note: options?.note ?? "دفعة عند إنشاء الطلب",
      createdById,
      receiptNumber,
      origin: ACCOUNT_PAYMENT_ORIGINS.SALE_INITIAL,
      sourceOrderId: orderId,
    },
  });
}

/** The ONE canonical way a standalone MANUAL payment is ever created —
 * always origin = MANUAL, always a fresh persisted PAY-YYYYMMDD-NNNN
 * (generateDailyPaymentReceiptNumber, same daily sequence/advisory-lock
 * technique used everywhere else), always createdById = the actual
 * authenticated actor. Every entry point that lets a human record a
 * standalone payment — ADMIN's recordAccountPayment
 * (src/app/admin/accounts/actions.ts), REP's recordMerchantPaymentAsRep
 * (src/app/rep/merchants/actions.ts), and ADMIN/ADMIN_ASSISTANT's
 * report-scoped createReplacementPaymentAction
 * (src/app/admin/reports/actions.ts) — calls this same function instead of
 * re-inlining the create, so receipt numbering / origin tagging / account
 * balance semantics can never drift between them. Callers still own their
 * own role guard, input validation, and post-create redirect target — this
 * only does the one shared insert. */
export async function recordManualAccountPayment(
  tx: Tx,
  accountId: string,
  amountCents: number,
  createdById: string,
  options?: {
    method?: string;
    note?: string;
    /** Set ONLY by the report-scoped replacement-payment flow — the
     * original cancelled MANUAL payment this new one corrects
     * (AccountPayment.correctsPaymentId, @unique — the DB-level "at most
     * one replacement per cancelled payment" guarantee). Omitted (the
     * normal case) for every ordinary standalone payment. */
    correctsPaymentId?: string;
  },
): Promise<{ id: string; receiptNumber: string | null }> {
  const receiptNumber = await generateDailyPaymentReceiptNumber(tx);
  return tx.accountPayment.create({
    data: {
      accountId,
      amountCents,
      method: options?.method ?? ACCOUNT_PAYMENT_METHODS.CASH,
      note: options?.note,
      createdById,
      receiptNumber,
      origin: ACCOUNT_PAYMENT_ORIGINS.MANUAL,
      correctsPaymentId: options?.correctsPaymentId,
    },
    select: { id: true, receiptNumber: true },
  });
}

/** Builds the /admin/orders/new deep link that pre-selects this account's
 * underlying identity (merchant / registered customer / walk-in), so
 * starting a new sale for an account never requires re-picking it from
 * scratch in the manual-order form. */
export function getNewOrderHrefForAccount(
  accountId: string,
  identity: { merchantId: string | null; customerId: string | null },
): string {
  if (identity.merchantId) {
    return `/admin/orders/new?mode=EXISTING_MERCHANT&merchantId=${identity.merchantId}`;
  }
  if (identity.customerId) {
    return `/admin/orders/new?mode=EXISTING_CUSTOMER&customerId=${identity.customerId}`;
  }
  return `/admin/orders/new?mode=WALK_IN&walkInAccountId=${accountId}`;
}

export interface AccountBalanceInput {
  /** CustomerAccount.openingBalanceCents — debt that existed before this
   * account's first Order under Ovi Mobile (see the schema doc comment).
   * Deliberately a REQUIRED field here (not optional/defaulted inside this
   * function) so every call site is forced, at compile time, to actually
   * select and pass it — the exact guarantee that no screen can silently
   * keep computing debt with the old two-term formula. Pass 0 explicitly
   * for a genuinely brand-new account that has none. */
  openingBalanceCents: number;
  orders: { status: string; totalCents: number }[];
  /** `cancellation` present (non-null) means this payment has been
   * reversed — see AccountPaymentCancellation in schema.prisma. Its
   * amountCents is still summed into totalPaidCents below (the original
   * payment's own historical effect is never erased) but is then added
   * straight back via totalReversedCents, netting to zero CURRENT effect —
   * never by silently excluding the payment from the sum, which would
   * produce the same number but not the same auditable formula. */
  payments: { amountCents: number; cancellation?: { id: string } | null }[];
}

/** The single source of truth for an account's balance due — never
 * duplicate this formula inline. Cancelled/returned orders are excluded
 * (isTerminalOrderStatus covers exactly the two statuses that also restore
 * inventory in order-lifecycle.ts, i.e. the sale was undone); a cancelled
 * payment nets to zero CURRENT effect (its original amount is still
 * subtracted, then added straight back — see AccountBalanceInput's own doc
 * comment) while its historical statement position stays untouched (see
 * buildAccountStatementRows). The result is always computed live from
 * openingBalanceCents + orders - payments + reversals, never stored,
 * matching Order.paidAmountCents's existing "never stored" convention.
 * openingBalanceCents represents pre-system debt entered once by an ADMIN
 * (see setAccountOpeningBalance in src/app/admin/accounts/actions.ts) —
 * never a fabricated Order or AccountPayment. */
export function getAccountBalanceCents(account: AccountBalanceInput): number {
  const totalOwedCents = account.orders
    .filter((order) => !isTerminalOrderStatus(order.status))
    .reduce((sum, order) => sum + order.totalCents, 0);
  const totalPaidCents = account.payments.reduce((sum, payment) => sum + payment.amountCents, 0);
  const totalReversedCents = account.payments
    .filter((payment) => payment.cancellation)
    .reduce((sum, payment) => sum + payment.amountCents, 0);
  return account.openingBalanceCents + totalOwedCents - totalPaidCents + totalReversedCents;
}

export interface OrderAccountPosition {
  /** The account's balance immediately BEFORE this specific order existed —
   * a genuinely HISTORICAL figure: later orders/payments (relative to this
   * one) never affect it, no matter when the invoice is actually viewed. */
  previousDebtCents: number;
  /** previousDebtCents + this order's own totalCents - this order's own
   * paidAmountCents — the account's position immediately after this sale
   * (and its immediate payment, if any), NOT the account's live balance
   * today. Also historical: unaffected by anything that happened to the
   * account after this sale. */
  debtAfterSaleCents: number;
}

export interface AccountHistoryInput {
  openingBalanceCents: number;
  /** Passed straight through to buildAccountStatementRows — never actually
   * used for ordering here (the opening balance is always included
   * unconditionally, see above), but required so this can't accidentally
   * diverge from the exact same AccountStatementInput shape the trusted
   * statement builder expects. */
  openingBalanceSetAt: Date | null;
  /** The account's FULL order list — must include this order itself (the
   * function locates it by orderNumber to find its place in the
   * chronology); every other order, before or after, is used only to
   * reconstruct what the balance stood at up to (not including) this one. */
  orders: AccountStatementOrderInput[];
  /** The account's FULL payment list, including this order's own immediate
   * payment if it has one — it's excluded from "previous" automatically by
   * chronology (see below), never by guessing which row it is. */
  payments: AccountStatementPaymentInput[];
}

/** Derives an invoice's "الذمة السابقة"/"الذمة بعد البيع" position for one
 * specific Order — a HISTORICAL snapshot, correct no matter how much later
 * the invoice is reopened. Reuses buildAccountStatementRows
 * (src/lib/account-statement.ts) — the same trusted chronological
 * ordering/tie-break/terminal-order logic the merchant statement page
 * already shows — rather than inventing a second accounting
 * interpretation: it returns one row per order/payment sorted by
 * (createdAt, then "orders before payments at an identical instant"), each
 * carrying the running balance immediately after that row.
 *
 * previousDebtCents is the running balance of the row immediately BEFORE
 * this order's own SALE row — i.e., every earlier order (excluding
 * cancelled/returned ones, exactly like getAccountBalanceCents) and every
 * earlier payment, plus the account's opening balance (always included,
 * unconditionally, the same way getAccountBalanceCents and
 * buildAccountStatementRows both treat it — never date-gated by
 * openingBalanceSetAt, since it represents debt that predates every
 * recorded order/payment).
 *
 * WHY THIS CORRECTLY EXCLUDES THE ORDER'S OWN IMMEDIATE PAYMENT: Postgres
 * evaluates each row's `createdAt DEFAULT CURRENT_TIMESTAMP` column at
 * TRANSACTION START, so an order and the AccountPayment posted for its
 * paidNow amount (created in the very same $transaction — see
 * createRepSaleCore / admin/orders/new/actions.ts) always share the exact
 * same createdAt value. buildAccountStatementRows's tie-break sorts every
 * order before every payment at an identical timestamp, so that immediate
 * payment always sorts strictly AFTER this order's own row — it can never
 * leak into "previous," with no timestamp-adjacency guessing or note
 * matching required.
 *
 * debtAfterSaleCents is then computed directly from this order's own
 * persisted totalCents/paidAmountCents (never by summing statement rows,
 * and never by trying to identify "the" AccountPayment row that belongs to
 * this sale) — the exact authoritative fields already used to create both
 * the Order and its AccountPayment in the first place.
 *
 * DELIBERATE CHOICE ON TERMINAL STATUS: earlier orders use their CURRENT
 * status (via isTerminalOrderStatus, inside buildAccountStatementRows) when
 * computing previousDebtCents — this app has no point-in-time status
 * history to reconstruct "was order X terminal as of this date", so a
 * cancellation always retroactively removes that order's contribution
 * everywhere, exactly matching getAccountBalanceCents's own existing
 * semantics; this is not a new interpretation, only reuse of the existing
 * one. THIS order's own current status is deliberately NOT checked for the
 * debtAfterSaleCents figure, even if it has since become terminal — an
 * invoice is the historical record of what was actually sold and charged
 * at the time, not a value that should retroactively zero itself out
 * because of a later cancellation (the account's CURRENT balance, via
 * getAccountBalanceCents, already correctly reflects that cancellation
 * going forward — this invoice figure intentionally does not).
 *
 * Never stores anything — pure display derivation, recomputed on every
 * view. Throws only if `order` is somehow missing from `account.orders`
 * (a caller bug: every call site fetches the account's orders including
 * this very order, since Order.accountId already points at it). */
export function getOrderAccountPosition(
  account: AccountHistoryInput,
  order: { orderNumber: string; totalCents: number; paidAmountCents: number },
): OrderAccountPosition {
  const rows = buildAccountStatementRows(account);
  const saleRowIndex = rows.findIndex((row) => row.type === "SALE" && row.reference === order.orderNumber);
  if (saleRowIndex === -1) {
    throw new Error(`getOrderAccountPosition: order ${order.orderNumber} not found in its own account's order list`);
  }

  const previousRow = saleRowIndex === 0 ? null : rows[saleRowIndex - 1];
  const previousDebtCents = previousRow ? previousRow.balanceCents : 0;
  const debtAfterSaleCents = previousDebtCents + order.totalCents - order.paidAmountCents;

  return { previousDebtCents, debtAfterSaleCents };
}

export interface PaymentAccountPosition {
  /** The account's balance immediately BEFORE this specific payment existed
   * — a genuinely HISTORICAL figure, exactly like OrderAccountPosition's
   * previousDebtCents: later orders/payments (relative to this one) never
   * affect it, no matter when the receipt is reopened. Can be negative (a
   * credit) — never clamped, see formatDebtOrCredit in account-labels.ts. */
  previousBalanceCents: number;
  /** previousBalanceCents - this payment's own amountCents — the account's
   * position immediately after this payment, NOT the account's live balance
   * today. Also historical: unaffected by anything that happened to the
   * account after this payment. */
  afterBalanceCents: number;
}

/** Derives a payment receipt's "الذمة السابقة"/"الذمة بعد الدفعة" position
 * for one specific AccountPayment — the exact same trusted-chronology
 * pattern getOrderAccountPosition uses for a sale invoice, applied to a
 * PAYMENT row instead of a SALE row. Reuses buildAccountStatementRows
 * unchanged (its PAYMENT rows already carry `reference: payment.id` — a
 * real, persisted, safe identifier — so no change to account-statement.ts
 * was needed to support this).
 *
 * previousBalanceCents is the running balance of the row immediately BEFORE
 * this payment's own PAYMENT row. Because Postgres evaluates every row's
 * `createdAt DEFAULT CURRENT_TIMESTAMP` at TRANSACTION START, a rep sale's
 * Order and its own immediate "paid now" AccountPayment (created in the
 * same $transaction) always share the exact same createdAt — and
 * buildAccountStatementRows's tie-break always sorts an order before a
 * payment at an identical instant, so a sale's own immediate payment always
 * sees that same sale's debit already applied in "previous," matching this
 * app's one established statement ordering rule (never a second, competing
 * one invented here).
 *
 * afterBalanceCents is computed directly from this payment's own persisted
 * amountCents (never by re-reading a row's creditCents, and never by trying
 * to guess which row is "this" payment from AccountPayment.note or any
 * other unstructured signal) — the exact authoritative field already used
 * to create the AccountPayment in the first place.
 *
 * Never stores anything — pure display derivation, recomputed on every
 * view. Throws only if `payment` is somehow missing from `account.payments`
 * (a caller bug: every call site fetches the account's payments including
 * this very payment, since AccountPayment.accountId already points at it). */
export function getPaymentAccountPosition(
  account: AccountHistoryInput,
  payment: { id: string; amountCents: number },
): PaymentAccountPosition {
  const rows = buildAccountStatementRows(account);
  const paymentRowIndex = rows.findIndex((row) => row.type === "PAYMENT" && row.reference === payment.id);
  if (paymentRowIndex === -1) {
    throw new Error(`getPaymentAccountPosition: payment ${payment.id} not found in its own account's payment list`);
  }

  const previousRow = paymentRowIndex === 0 ? null : rows[paymentRowIndex - 1];
  const previousBalanceCents = previousRow ? previousRow.balanceCents : 0;
  const afterBalanceCents = previousBalanceCents - payment.amountCents;

  return { previousBalanceCents, afterBalanceCents };
}
