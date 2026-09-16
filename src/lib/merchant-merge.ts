import "server-only";
import { Prisma } from "@prisma/client";
import { MERCHANT_STATUSES, ADMIN_AUDIT_ACTIONS } from "@/lib/constants";
import { getAccountBalanceCents, getOrCreateMerchantAccount, lockAccountForBalanceUpdate, type AccountBalanceInput } from "@/lib/accounts";

type Tx = Prisma.TransactionClient;

export class MerchantMergeError extends Error {
  constructor(
    message: string,
    /** Machine-readable reason, mirrored 1:1 onto an Arabic message by the
     * caller (src/app/admin/merchants/[id]/merge/actions.ts) — kept
     * separate from `message` so this library never hardcodes UI text. */
    public readonly code: "SAME_MERCHANT" | "NOT_FOUND" | "CONFLICTING_LOGINS" | "INVARIANT_FAILED",
  ) {
    super(message);
    this.name = "MerchantMergeError";
  }
}

export type LoginTransferPlan =
  /** Neither merchant has a linked User, or only TARGET does — nothing to
   * transfer; TARGET's own login (if any) is untouched either way. */
  | { kind: "NONE" }
  /** SOURCE has a linked User, TARGET does not — that login moves to
   * TARGET atomically with the rest of the merge (see mergeMerchants) so
   * the real person behind it keeps reaching their (now-merged) account
   * under the surviving canonical merchant, instead of being stranded on a
   * SUSPENDED one. */
  | { kind: "TRANSFER"; userId: string }
  /** Both SOURCE and TARGET have their OWN, DIFFERENT linked User — merging
   * would have to silently pick one real person's login over the other's.
   * mergeMerchants refuses this outright (CONFLICTING_LOGINS) rather than
   * guess. (Merchant.userId is @unique, so "the same User linked to both"
   * is a DB-level impossibility — never a case to handle here.) */
  | { kind: "CONFLICT" };

/** The ONE place SOURCE/TARGET's linked-login situation is interpreted —
 * shared by previewMerchantMerge (so the admin sees this BEFORE confirming,
 * per the feature's own requirement) and mergeMerchants (so the actual
 * transfer/rejection can never diverge from what the preview promised). */
export function resolveLoginTransferPlan(source: { userId: string | null }, target: { userId: string | null }): LoginTransferPlan {
  if (source.userId && target.userId) {
    return { kind: "CONFLICT" };
  }
  if (source.userId && !target.userId) {
    return { kind: "TRANSFER", userId: source.userId };
  }
  return { kind: "NONE" };
}

const ACCOUNT_SELECT = {
  id: true,
  openingBalanceCents: true,
  orders: { select: { status: true, totalCents: true } },
  payments: { select: { amountCents: true, cancellation: { select: { id: true } } } },
} satisfies Prisma.CustomerAccountSelect;

type AccountSnapshot = Prisma.CustomerAccountGetPayload<{ select: typeof ACCOUNT_SELECT }>;

/** Every figure this module checks before/after a merge, in integer cents —
 * the exact set of invariants the feature's own design calls for (see
 * mergeMerchants's doc comment). Computed identically for SOURCE, TARGET,
 * and the resulting TARGET-after-merge snapshot so the three are always
 * directly comparable. */
interface AccountLedgerFigures {
  balanceCents: number;
  orderCount: number;
  paymentCount: number;
  salesTotalCents: number;
  paymentTotalCents: number;
}

const EMPTY_FIGURES: AccountLedgerFigures = {
  balanceCents: 0,
  orderCount: 0,
  paymentCount: 0,
  salesTotalCents: 0,
  paymentTotalCents: 0,
};

function computeLedgerFigures(account: AccountSnapshot | null): AccountLedgerFigures {
  if (!account) return EMPTY_FIGURES;
  const balanceInput: AccountBalanceInput = { openingBalanceCents: account.openingBalanceCents, orders: account.orders, payments: account.payments };
  return {
    balanceCents: getAccountBalanceCents(balanceInput),
    orderCount: account.orders.length,
    paymentCount: account.payments.length,
    salesTotalCents: account.orders.reduce((sum, order) => sum + order.totalCents, 0),
    paymentTotalCents: account.payments.reduce((sum, payment) => sum + payment.amountCents, 0),
  };
}

export interface MergePreview {
  source: { id: string; businessName: string; status: string; userId: string | null };
  target: { id: string; businessName: string; status: string; userId: string | null };
  sourceFigures: AccountLedgerFigures;
  targetFigures: AccountLedgerFigures;
  /** Simple sum of sourceFigures + targetFigures — the SAME arithmetic
   * mergeMerchants itself verifies actually happened after the real merge;
   * shown to the admin before they commit, never a separately-guessed
   * number. */
  expectedAfter: AccountLedgerFigures;
  sourceRepCustomerOrderCount: number;
  targetRepCustomerOrderCount: number;
  /** How SOURCE/TARGET's linked logins (if any) will be reconciled — see
   * resolveLoginTransferPlan. Computed here so the merge preview UI can
   * show/block on a CONFLICT BEFORE the admin ever reaches the confirm
   * step, not just discover it as a rejected submission. */
  loginTransferPlan: LoginTransferPlan;
}

/** Read-only merge preview — used by the /admin/merchants/[id]/merge page to
 * show "قبل الدمج" / "بعد الدمج" figures before the admin confirms.
 * Deliberately reuses the exact same ACCOUNT_SELECT/computeLedgerFigures
 * mergeMerchants itself uses for its pre/post invariant check, so the
 * preview can never show a different number than what the real merge will
 * actually produce. Never mutates anything — safe to call outside a
 * transaction, and safe to call repeatedly (e.g. on every page load while
 * the admin is still deciding). */
export async function previewMerchantMerge(tx: Tx, sourceMerchantId: string, targetMerchantId: string): Promise<MergePreview> {
  const [source, target] = await Promise.all([
    tx.merchant.findUnique({
      where: { id: sourceMerchantId },
      select: { id: true, businessName: true, status: true, userId: true, account: { select: ACCOUNT_SELECT }, _count: { select: { repCustomerOrders: true } } },
    }),
    tx.merchant.findUnique({
      where: { id: targetMerchantId },
      select: { id: true, businessName: true, status: true, userId: true, account: { select: ACCOUNT_SELECT }, _count: { select: { repCustomerOrders: true } } },
    }),
  ]);
  if (!source || !target) {
    throw new MerchantMergeError("One of the two merchant records could not be found", "NOT_FOUND");
  }

  const sourceFigures = computeLedgerFigures(source.account);
  const targetFigures = computeLedgerFigures(target.account);
  const expectedAfter: AccountLedgerFigures = {
    balanceCents: sourceFigures.balanceCents + targetFigures.balanceCents,
    orderCount: sourceFigures.orderCount + targetFigures.orderCount,
    paymentCount: sourceFigures.paymentCount + targetFigures.paymentCount,
    salesTotalCents: sourceFigures.salesTotalCents + targetFigures.salesTotalCents,
    paymentTotalCents: sourceFigures.paymentTotalCents + targetFigures.paymentTotalCents,
  };

  return {
    source: { id: source.id, businessName: source.businessName, status: source.status, userId: source.userId },
    target: { id: target.id, businessName: target.businessName, status: target.status, userId: target.userId },
    sourceFigures,
    targetFigures,
    expectedAfter,
    sourceRepCustomerOrderCount: source._count.repCustomerOrders,
    targetRepCustomerOrderCount: target._count.repCustomerOrders,
    loginTransferPlan: resolveLoginTransferPlan(source, target),
  };
}

export interface MergeMerchantsResult {
  targetMerchantId: string;
  targetAccountId: string | null;
  before: MergePreview;
  after: AccountLedgerFigures;
}

/** Merges a duplicate merchant (SOURCE) into the canonical one (TARGET) —
 * the ONE place this ever happens. MUST be called inside the caller's own
 * `prisma.$transaction` (never opens one itself, so the caller can wrap
 * this together with whatever else needs the same atomicity — in practice
 * just this, via confirmMerchantMergeAction). Every failure throws
 * MerchantMergeError (or lets a genuine invariant assertion throw), which
 * rolls back the ENTIRE transaction — there is no partial-merge state this
 * function can leave behind.
 *
 * WHAT THIS DOES NOT DO, ON PURPOSE (see the feature's own audit — every
 * one of these is a deliberate scope boundary, not an oversight):
 * - Never recalculates or hand-writes a final balance — every cents figure
 *   below is either moved verbatim (orders/payments keep their own
 *   totalCents/amountCents untouched) or summed via the SAME
 *   getAccountBalanceCents formula src/lib/accounts.ts already uses
 *   everywhere else. There is no second, competing balance formula here.
 * - Never edits Order.orderNumber, AccountPayment.receiptNumber,
 *   Order.createdByRepId, or AccountPayment.createdById — REP attribution
 *   and every document number are permanent historical facts, unaffected
 *   by which merchant/account the row is currently filed under.
 * - Never touches Product/InventoryItem/StockMovement — this is a
 *   merchant/account-ledger operation only; nothing here can move a single
 *   physical unit of stock.
 * - Never deletes SOURCE. Matches this app's own existing archival
 *   convention (see deleteMerchant's "SUSPENDED doubles as the archival
 *   state" doc comment in src/app/admin/merchants/actions.ts) rather than
 *   inventing a new soft-delete mechanism: every FK pointing AT Merchant
 *   (orders.merchantId, rep_customer_orders.merchantId,
 *   customer_accounts.merchantId) is ON DELETE SET NULL, so a hard delete
 *   would silently sever historical references even after everything
 *   meaningful has already been moved off SOURCE — there is no reason to
 *   risk that when SUSPENDED already means exactly "no longer an
 *   active/selectable merchant" everywhere else in the app (order
 *   creation, checkout, rep-sale eligibility all already gate on
 *   status === APPROVED).
 * - LOGIN IDENTITY (see resolveLoginTransferPlan): if only SOURCE has a
 *   linked User, that login is TRANSFERRED to TARGET (Merchant.userId) in
 *   this same transaction — the real person behind a login-linked duplicate
 *   keeps signing in exactly as before, and /merchant's own
 *   `Merchant.findUnique({ where: { userId } })` lookup now resolves to
 *   TARGET, whose Orders already include everything moved from SOURCE — so
 *   nothing appears stranded on an archived record. If NEITHER has a login,
 *   or only TARGET does, nothing about logins changes. If BOTH have their
 *   own, DIFFERENT linked User, this function refuses the merge entirely
 *   (CONFLICTING_LOGINS, thrown before any write) rather than silently
 *   picking one real person's identity over the other's.
 * - Never changes TARGET's own profile fields (businessName/contactPhone/
 *   assignedRepId/etc.) — TARGET's identity is the canonical one exactly
 *   as it already stood; only SOURCE's history (and, per the login-identity
 *   rule above, possibly its login) moves TO it.
 *
 * LOCKING: both accounts (when they exist) are locked via the existing
 * lockAccountForBalanceUpdate advisory-lock helper — never a new locking
 * mechanism — in sorted-id order (deterministic, so two concurrent merges
 * touching an overlapping pair of accounts can never deadlock against each
 * other, the same reasoning lockAccountForBalanceUpdate's own doc comment
 * already establishes for its callers). Locking happens BEFORE any read
 * used for the invariant snapshot, so a concurrent sale/payment against
 * either account cannot race the merge — it simply waits for this
 * transaction to commit or roll back first. */
export async function mergeMerchants(
  tx: Tx,
  params: { sourceMerchantId: string; targetMerchantId: string; adminId: string },
): Promise<MergeMerchantsResult> {
  const { sourceMerchantId, targetMerchantId, adminId } = params;

  if (sourceMerchantId === targetMerchantId) {
    throw new MerchantMergeError("Cannot merge a merchant with itself", "SAME_MERCHANT");
  }

  const [source, target] = await Promise.all([
    tx.merchant.findUnique({ where: { id: sourceMerchantId }, select: { id: true, userId: true, status: true, businessName: true, notes: true, account: { select: { id: true } } } }),
    tx.merchant.findUnique({ where: { id: targetMerchantId }, select: { id: true, userId: true, status: true, businessName: true, account: { select: { id: true } } } }),
  ]);
  if (!source || !target) {
    throw new MerchantMergeError("One of the two merchant records could not be found", "NOT_FOUND");
  }

  // Fail fast, before any write (including the lazy account creation
  // below) — see resolveLoginTransferPlan's own doc comment for why a
  // CONFLICT (both merchants have their own, different linked User) can
  // never be silently resolved by picking one.
  const loginTransferPlan = resolveLoginTransferPlan(source, target);
  if (loginTransferPlan.kind === "CONFLICT") {
    throw new MerchantMergeError("Both merchants have their own, different linked user login", "CONFLICTING_LOGINS");
  }

  // Lazily create TARGET's account if it doesn't have one yet (mirrors
  // getOrCreateMerchantAccount's existing use in updateMerchantStatus) —
  // only when SOURCE actually has ledger data to move; a merge between two
  // merchants that neither ever had an account needs no account at all.
  // SOURCE's account is never lazily created here: if it doesn't have one,
  // there is nothing in its ledger to move.
  const sourceAccountId = source.account?.id ?? null;
  const targetAccountId = target.account?.id ?? (sourceAccountId ? await getOrCreateMerchantAccount(tx, targetMerchantId) : null);

  // Deterministic lock order — sorted account ids, exactly the same
  // "avoid deadlock via a fixed global ordering" principle
  // lockAccountForBalanceUpdate's own doc comment establishes for every
  // other multi-lock caller in this codebase.
  const idsToLock = [sourceAccountId, targetAccountId].filter((id): id is string => id !== null).sort();
  for (const id of idsToLock) {
    await lockAccountForBalanceUpdate(tx, id);
  }

  const before = await previewMerchantMerge(tx, sourceMerchantId, targetMerchantId);

  // ---- MOVE: Orders — merchantId (display/attribution) and accountId
  // (ledger) are independent columns on Order; both are reassigned so
  // every consumer that filters by either one (the merchant detail page,
  // /admin/reports?merchantId=, the merchant's own account statement) sees
  // a consistent picture. Neither call touches orderNumber, totalCents,
  // paidAmountCents, status, createdByRepId, or any inventory-related
  // field — only the two FK columns above move.
  await tx.order.updateMany({ where: { merchantId: sourceMerchantId }, data: { merchantId: targetMerchantId } });
  if (sourceAccountId && targetAccountId) {
    await tx.order.updateMany({ where: { accountId: sourceAccountId }, data: { accountId: targetAccountId } });
  }

  // ---- MOVE: RepCustomerOrder — a purely display/grouping identity for
  // /admin/reps/[id] (no financial data of its own), reassigned the same
  // way.
  await tx.repCustomerOrder.updateMany({ where: { merchantId: sourceMerchantId }, data: { merchantId: targetMerchantId } });

  // ---- MOVE: AccountPayment — accountId only. receiptNumber, amountCents,
  // createdById, createdAt, origin, sourceOrderId, correctsPaymentId, and
  // the cancellation relation are all untouched — a payment keeps every
  // one of its own historical facts, it simply now belongs to TARGET's
  // ledger.
  if (sourceAccountId && targetAccountId) {
    await tx.accountPayment.updateMany({ where: { accountId: sourceAccountId }, data: { accountId: targetAccountId } });
  }

  // ---- COMBINE opening balances. Both are always >= 0 by this system's
  // own existing invariant (see openingBalanceMoneyString in
  // src/lib/validation/accounts.ts — the ONLY place openingBalanceCents is
  // ever written), so their sum is always >= 0 too: a plain addition is
  // the correct "algebraic combination," never a case requiring
  // negative-number handling. The RESULTING account balance (via
  // getAccountBalanceCents, which nets opening + orders - payments +
  // reversals) can still legitimately be negative — a credit — exactly as
  // it already could before this merge; that is handled by the existing
  // formula/display layer (formatDebtOrCredit), not by anything special
  // here.
  //
  // SOURCE's own account is drained rather than deleted or repointed —
  // CustomerAccount.merchantId is @unique, so it can never be repointed to
  // TARGET while TARGET already has its own account. Its
  // openingBalanceCents is zeroed (its economic value now lives on
  // TARGET); openingBalanceSetAt/openingBalanceSetById are deliberately
  // LEFT UNTOUCHED — they record a true historical fact ("an admin once
  // set this account's opening balance"), and zeroing them would let
  // deleteMerchant's own hasOpeningBalanceHistory check later think this
  // account never had one, wrongly permitting a hard delete of a merged
  // merchant that genuinely once carried real financial history.
  // isActive is set false — an existing, currently-unused CustomerAccount
  // field given its first real meaning here rather than adding a new one.
  if (sourceAccountId && targetAccountId) {
    const sourceAccount = await tx.customerAccount.findUniqueOrThrow({ where: { id: sourceAccountId }, select: { openingBalanceCents: true } });
    const targetAccount = await tx.customerAccount.findUniqueOrThrow({ where: { id: targetAccountId }, select: { openingBalanceCents: true } });
    await tx.customerAccount.update({
      where: { id: targetAccountId },
      data: {
        openingBalanceCents: targetAccount.openingBalanceCents + sourceAccount.openingBalanceCents,
        openingBalanceSetAt: new Date(),
        openingBalanceSetById: adminId,
      },
    });
    await tx.customerAccount.update({ where: { id: sourceAccountId }, data: { openingBalanceCents: 0, isActive: false } });
  }

  // ---- Archive SOURCE (never delete — see this function's own doc
  // comment) and leave a breadcrumb in its own notes field (an existing,
  // free-form, display-only field — never parsed by any business logic,
  // including Ovi AI's merchant tools) so a human or Ovi AI later looking
  // directly at the archived SOURCE record is pointed at TARGET instead of
  // reporting stale/zero figures with no context.
  //
  // If a login transfer applies, SOURCE.userId is nulled out in THIS SAME
  // statement — and only afterward, in the next statement below, is
  // TARGET.userId set to that value. Merchant.userId is @unique, so this
  // order is required: releasing SOURCE's claim on it first, then handing
  // it to TARGET, avoids a transient unique-constraint violation (Postgres
  // checks a plain UNIQUE constraint per-statement, not deferred).
  const mergeNote = `تم دمج هذا التاجر مع "${target.businessName}" (معرّف: ${targetMerchantId}) بتاريخ ${new Date().toLocaleDateString("ar")}. راجع السجل الكامل هناك.`;
  await tx.merchant.update({
    where: { id: sourceMerchantId },
    data: {
      status: MERCHANT_STATUSES.SUSPENDED,
      notes: source.notes ? `${source.notes}\n\n${mergeNote}` : mergeNote,
      ...(loginTransferPlan.kind === "TRANSFER" ? { userId: null } : {}),
    },
  });
  if (loginTransferPlan.kind === "TRANSFER") {
    await tx.merchant.update({ where: { id: targetMerchantId }, data: { userId: loginTransferPlan.userId } });
  }

  // ---- AUDIT LOG — same "AdminAuditLog targets a User account; a
  // login-less merchant has none" limitation updateMerchantStatus already
  // documents and works around by skipping the write. Prefers the
  // POST-merge canonical linked user (loginTransferPlan.userId when a
  // transfer just happened — target.userId in memory is still the
  // pre-merge, now-stale value) over TARGET's own pre-existing one, falling
  // back to SOURCE's.
  const auditTargetUserId = (loginTransferPlan.kind === "TRANSFER" ? loginTransferPlan.userId : target.userId) ?? source.userId;
  const after = computeLedgerFigures(
    targetAccountId ? await tx.customerAccount.findUnique({ where: { id: targetAccountId }, select: ACCOUNT_SELECT }) : null,
  );
  if (auditTargetUserId) {
    await tx.adminAuditLog.create({
      data: {
        adminUserId: adminId,
        targetUserId: auditTargetUserId,
        action: ADMIN_AUDIT_ACTIONS.MERCHANT_MERGED,
        oldValue: {
          sourceMerchantId,
          sourceBusinessName: source.businessName,
          targetMerchantId,
          targetBusinessName: target.businessName,
          sourceBalanceBeforeCents: before.sourceFigures.balanceCents,
          targetBalanceBeforeCents: before.targetFigures.balanceCents,
        },
        newValue: { resultingBalanceCents: after.balanceCents },
      },
    });
  }

  // ---- INVARIANTS — verified INSIDE this same transaction, before it can
  // ever commit. Any mismatch throws, which rolls back every write above
  // (orders, payments, opening balances, SOURCE's archival, the audit log)
  // atomically — there is no way for this function to return successfully
  // while leaving mismatched data behind.
  const expected = before.expectedAfter;
  if (after.balanceCents !== expected.balanceCents) {
    throw new MerchantMergeError(`Resulting balance ${after.balanceCents} does not equal expected combined balance ${expected.balanceCents}`, "INVARIANT_FAILED");
  }
  if (after.orderCount !== expected.orderCount) {
    throw new MerchantMergeError(`Resulting order count ${after.orderCount} does not equal expected ${expected.orderCount}`, "INVARIANT_FAILED");
  }
  if (after.paymentCount !== expected.paymentCount) {
    throw new MerchantMergeError(`Resulting payment count ${after.paymentCount} does not equal expected ${expected.paymentCount}`, "INVARIANT_FAILED");
  }
  if (after.salesTotalCents !== expected.salesTotalCents) {
    throw new MerchantMergeError(`Resulting sales total ${after.salesTotalCents} does not equal expected ${expected.salesTotalCents}`, "INVARIANT_FAILED");
  }
  if (after.paymentTotalCents !== expected.paymentTotalCents) {
    throw new MerchantMergeError(`Resulting payment total ${after.paymentTotalCents} does not equal expected ${expected.paymentTotalCents}`, "INVARIANT_FAILED");
  }

  // ---- Additional structural/identity invariants — every one of these
  // re-reads the ACTUAL post-write rows (never trusts an in-memory
  // assumption), so a bug in any MOVE/archive step above would be caught
  // right here and roll back the whole transaction.
  const [sourceRepCustomerOrderCountAfter, targetRepCustomerOrderCountAfter, sourceOrderMerchantCountAfter, sourceOrderAccountCountAfter, sourcePaymentAccountCountAfter, sourceMerchantAfter, targetAccountAfter] =
    await Promise.all([
      tx.repCustomerOrder.count({ where: { merchantId: sourceMerchantId } }),
      tx.repCustomerOrder.count({ where: { merchantId: targetMerchantId } }),
      tx.order.count({ where: { merchantId: sourceMerchantId } }),
      sourceAccountId ? tx.order.count({ where: { accountId: sourceAccountId } }) : Promise.resolve(0),
      sourceAccountId ? tx.accountPayment.count({ where: { accountId: sourceAccountId } }) : Promise.resolve(0),
      tx.merchant.findUniqueOrThrow({ where: { id: sourceMerchantId }, select: { status: true, userId: true } }),
      targetAccountId ? tx.customerAccount.findUniqueOrThrow({ where: { id: targetAccountId }, select: { isActive: true } }) : Promise.resolve(null),
    ]);

  if (sourceRepCustomerOrderCountAfter !== 0) {
    throw new MerchantMergeError(`SOURCE still has ${sourceRepCustomerOrderCountAfter} RepCustomerOrder reference(s) after merge`, "INVARIANT_FAILED");
  }
  const expectedTargetRepCustomerOrderCount = before.sourceRepCustomerOrderCount + before.targetRepCustomerOrderCount;
  if (targetRepCustomerOrderCountAfter !== expectedTargetRepCustomerOrderCount) {
    throw new MerchantMergeError(
      `TARGET RepCustomerOrder count ${targetRepCustomerOrderCountAfter} does not equal expected ${expectedTargetRepCustomerOrderCount}`,
      "INVARIANT_FAILED",
    );
  }
  if (sourceOrderMerchantCountAfter !== 0) {
    throw new MerchantMergeError(`SOURCE still has ${sourceOrderMerchantCountAfter} Order.merchantId reference(s) after merge`, "INVARIANT_FAILED");
  }
  if (sourceOrderAccountCountAfter !== 0) {
    throw new MerchantMergeError(`SOURCE still has ${sourceOrderAccountCountAfter} Order.accountId reference(s) after merge`, "INVARIANT_FAILED");
  }
  if (sourcePaymentAccountCountAfter !== 0) {
    throw new MerchantMergeError(`SOURCE still has ${sourcePaymentAccountCountAfter} AccountPayment.accountId reference(s) after merge`, "INVARIANT_FAILED");
  }
  if (sourceMerchantAfter.status !== MERCHANT_STATUSES.SUSPENDED) {
    throw new MerchantMergeError(`SOURCE status is ${sourceMerchantAfter.status}, expected SUSPENDED`, "INVARIANT_FAILED");
  }
  if (sourceAccountId) {
    const sourceAccountAfter = await tx.customerAccount.findUniqueOrThrow({ where: { id: sourceAccountId }, select: { openingBalanceCents: true, isActive: true } });
    if (sourceAccountAfter.openingBalanceCents !== 0) {
      throw new MerchantMergeError(`SOURCE account openingBalanceCents is ${sourceAccountAfter.openingBalanceCents}, expected 0`, "INVARIANT_FAILED");
    }
    if (sourceAccountAfter.isActive !== false) {
      throw new MerchantMergeError("SOURCE account isActive is still true, expected false", "INVARIANT_FAILED");
    }
  }
  if (targetAccountAfter && targetAccountAfter.isActive !== true) {
    throw new MerchantMergeError("TARGET account isActive is false, expected true", "INVARIANT_FAILED");
  }
  if (loginTransferPlan.kind === "TRANSFER") {
    if (sourceMerchantAfter.userId !== null) {
      throw new MerchantMergeError("SOURCE.userId is still set after a login transfer, expected null", "INVARIANT_FAILED");
    }
    const targetMerchantAfter = await tx.merchant.findUniqueOrThrow({ where: { id: targetMerchantId }, select: { userId: true } });
    if (targetMerchantAfter.userId !== loginTransferPlan.userId) {
      throw new MerchantMergeError(`TARGET.userId is ${targetMerchantAfter.userId}, expected the transferred ${loginTransferPlan.userId}`, "INVARIANT_FAILED");
    }
  }

  return { targetMerchantId, targetAccountId, before, after };
}
