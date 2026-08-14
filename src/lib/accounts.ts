import "server-only";
import { Prisma } from "@prisma/client";
import { isTerminalOrderStatus } from "@/lib/order-lifecycle-rules";
import { ACCOUNT_PAYMENT_METHODS } from "@/lib/constants";

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
 * paidAmountCents > 0, in the same transaction as the order creation. */
export async function recordInitialAccountPayment(
  tx: Tx,
  accountId: string,
  amountCents: number,
  createdById: string,
): Promise<void> {
  await tx.accountPayment.create({
    data: {
      accountId,
      amountCents,
      method: ACCOUNT_PAYMENT_METHODS.CASH,
      note: "دفعة عند إنشاء الطلب",
      createdById,
    },
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
  orders: { status: string; totalCents: number }[];
  payments: { amountCents: number }[];
}

/** The single source of truth for an account's balance due — never
 * duplicate this formula inline. Cancelled/returned orders are excluded
 * (isTerminalOrderStatus covers exactly the two statuses that also restore
 * inventory in order-lifecycle.ts, i.e. the sale was undone), and the
 * result is always computed live from orders + payments, never stored,
 * matching Order.paidAmountCents's existing "never stored" convention. */
export function getAccountBalanceCents(account: AccountBalanceInput): number {
  const totalOwedCents = account.orders
    .filter((order) => !isTerminalOrderStatus(order.status))
    .reduce((sum, order) => sum + order.totalCents, 0);
  const totalPaidCents = account.payments.reduce((sum, payment) => sum + payment.amountCents, 0);
  return totalOwedCents - totalPaidCents;
}
