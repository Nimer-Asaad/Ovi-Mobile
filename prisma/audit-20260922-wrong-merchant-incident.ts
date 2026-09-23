/**
 * READ-ONLY incident audit for the 2026-09-22 "wrong merchant" report.
 *
 * ============================================================================
 * THIS SCRIPT IS NEVER RUN BY THE ASSISTANT. It is a deliverable for the
 * USER to run themselves, from wherever they have legitimate read access to
 * the real database (their own machine/VPS session) — the assistant that
 * wrote this file never SSHs, deploys, or connects to production, and did
 * NOT execute this script against real data. Every finding in the
 * implementation report that accompanies this file is a description of what
 * this script WOULD check, not an executed result.
 * ============================================================================
 *
 * SAFETY: this script issues ONLY read queries — findMany/findUnique/
 * findFirst/count/groupBy. Grep it yourself before running:
 *   grep -nE "\.(create|update|delete|upsert|createMany|updateMany|deleteMany)\(|\$executeRaw|\$transaction" prisma/audit-20260922-wrong-merchant-incident.ts
 * should print nothing. No CREATE, no UPDATE, no DELETE, no migration, no
 * $transaction. It connects using whatever DATABASE_URL/DIRECT_URL is
 * already set in the environment you run it in (deliberately — unlike
 * prisma/verify-*.ts scripts, this one's whole purpose is inspecting REAL
 * incident data, so it does not use verify-guardrails.ts's disposable-DB
 * requirement). CONFIRM you know what DATABASE_URL points to before running
 * this anywhere.
 *
 * Run with: node --conditions=react-server --import tsx prisma/audit-20260922-wrong-merchant-incident.ts
 *
 * WHAT THIS DOES:
 *   1. Loads the three known anchors (Order OVI-20260922-0006, its return
 *      OVI-20260922-0006-R1, and AccountPayment PAY-20260922-0012) and every
 *      record connected to them by REAL relations (merchant, account, rep,
 *      order<->payment<->return links) — never by sequence-number proximity.
 *   2. Expands the search to every Order/AccountPayment/SalesReturn created
 *      by the SAME rep, involving the SAME merchant(s)/account(s), on the
 *      SAME Palestine business date as the anchors — the actual candidate
 *      pool for "this incident", not a date-blind global scan.
 *   3. Classifies each candidate into:
 *        A) DEFINITELY PART OF THE INCIDENT — connected to an anchor by a
 *           real FK/relation (same order, same account+rep+minute cluster
 *           the rep himself described as "repeating the process").
 *        B) POSSIBLY RELATED / AMBIGUOUS — same rep/day but not directly
 *           linked to an anchor by relation; needs a human judgment call.
 *        C) UNRELATED — everything else that only matched a naive
 *           sequence-number range and nothing else.
 *   4. Prints, for every record, whether Order.merchantId's owning account
 *      equals Order.accountId's own merchantId (the exact invariant Part 7
 *      of this task is about) — flagging any row where they'd disagree.
 *   5. Proposes (PRINTS ONLY — never executes) a safe correction sequence
 *      using the EXISTING reversal/correction architecture:
 *        1. reverse any ACTIVE SalesReturn among the incident records
 *           (reverseSalesReturn, src/lib/sales-return-reversal.ts)
 *        2. cancel any linked MANUAL AccountPayment among them
 *           (cancelManualPayment, src/lib/payment-correction.ts) — a
 *           SALE_INITIAL payment is instead handled by step 3 below
 *        3. correct/cancel the linked Order(s)
 *           (correctSale, src/lib/sale-correction.ts)
 *      For each proposed step it prints the expected balance/stock/order/
 *      payment effect BEFORE any button is ever clicked — it never calls
 *      any of these functions itself.
 */

export {};

import { isTerminalOrderStatus, getValidNextOrderStatuses } from "../src/lib/order-lifecycle-rules";
import { ORDER_STATUSES } from "../src/lib/constants";

const ANCHOR_ORDER_NUMBER = "OVI-20260922-0006";
const ANCHOR_RETURN_REFERENCE = "OVI-20260922-0006-R1";
const ANCHOR_PAYMENT_REFERENCE = "PAY-20260922-0012";
const INCIDENT_BUSINESS_DATE = "2026-09-22";

function line(char = "="): void {
  console.log(char.repeat(78));
}
function section(title: string): void {
  line();
  console.log(title);
  line();
}

async function main() {
  const { PrismaClient } = await import("@prisma/client");
  const prisma = new PrismaClient();

  try {
    section(`INCIDENT DRY-RUN AUDIT — ${INCIDENT_BUSINESS_DATE} wrong-merchant report (READ-ONLY, no writes)`);
    console.log(`Anchors: ${ANCHOR_ORDER_NUMBER} / ${ANCHOR_RETURN_REFERENCE} / ${ANCHOR_PAYMENT_REFERENCE}\n`);

    // ------------------------------------------------------------------
    // STEP 1 — load the anchor Order and everything it directly relates to.
    // ------------------------------------------------------------------
    const anchorOrder = await prisma.order.findUnique({
      where: { orderNumber: ANCHOR_ORDER_NUMBER },
      select: {
        id: true,
        orderNumber: true,
        createdAt: true,
        status: true,
        source: true,
        totalCents: true,
        paidAmountCents: true,
        contactName: true,
        contactPhone: true,
        merchantId: true,
        accountId: true,
        createdByRepId: true,
        merchant: { select: { id: true, businessName: true, contactPhone: true, assignedRepId: true } },
        account: { select: { id: true, merchantId: true, displayName: true } },
        createdByRep: { select: { id: true, user: { select: { id: true, name: true } } } },
        initialPayment: { select: { id: true, receiptNumber: true, amountCents: true, cancellation: { select: { id: true } } } },
        salesReturns: { select: { id: true, sequence: true, totalCreditCents: true, createdAt: true, reversal: { select: { id: true } } } },
      },
    });

    if (!anchorOrder) {
      console.log(`Anchor order ${ANCHOR_ORDER_NUMBER} was NOT FOUND in this database. Stopping — nothing else can be safely derived without it.`);
      return;
    }

    console.log("Anchor order found:");
    console.log(JSON.stringify(anchorOrder, null, 2));

    const invariantOk = anchorOrder.merchantId === anchorOrder.account?.merchantId;
    console.log(`\nInvariant check — Order.merchantId === Order.account.merchantId: ${invariantOk ? "OK (matches)" : "*** MISMATCH — Order.merchantId and its own account's merchantId disagree ***"}`);
    if (!invariantOk) {
      console.log(`  Order.merchantId       = ${anchorOrder.merchantId} (${anchorOrder.merchant?.businessName ?? "—"})`);
      console.log(`  Order.account.merchantId = ${anchorOrder.account?.merchantId} (owning account: ${anchorOrder.account?.id})`);
    }

    if (!anchorOrder.createdByRepId || !anchorOrder.merchantId) {
      console.log("\nAnchor order has no rep or no merchant attached — cannot expand the candidate pool by rep/merchant. Stopping here.");
      return;
    }
    const repId = anchorOrder.createdByRepId;
    const repUserId = anchorOrder.createdByRep!.user.id;

    // ------------------------------------------------------------------
    // STEP 2 — every merchant this rep sold to (or collected a payment
    // from) on the incident's Palestine business date, PLUS every
    // merchant this rep is assigned to whose business name looks like
    // "وجدي" or "عمر" (the two names in the report) — printed for a human
    // to visually confirm which Merchant rows those names actually are.
    // ------------------------------------------------------------------
    section("STEP 2 — candidate merchants for this rep (same-day activity + name match)");
    const [ordersThatDay, paymentsThatDay, nameMatches] = await Promise.all([
      prisma.$queryRaw<{ id: string; orderNumber: string; createdAt: Date; merchantId: string | null; accountId: string | null; totalCents: number; status: string }[]>`
        SELECT "id", "orderNumber", "createdAt", "merchantId", "accountId", "totalCents", "status" FROM "orders"
        WHERE "createdByRepId" = ${repId}
          AND (("createdAt" AT TIME ZONE current_setting('TIMEZONE')) AT TIME ZONE 'Asia/Hebron')::date = ${INCIDENT_BUSINESS_DATE}::date
        ORDER BY "createdAt" ASC
      `,
      prisma.$queryRaw<{ id: string; receiptNumber: string | null; createdAt: Date; accountId: string; amountCents: number; origin: string | null }[]>`
        SELECT "id", "receiptNumber", "createdAt", "accountId", "amountCents", "origin" FROM "account_payments"
        WHERE "createdById" = ${repUserId}
          AND (("createdAt" AT TIME ZONE current_setting('TIMEZONE')) AT TIME ZONE 'Asia/Hebron')::date = ${INCIDENT_BUSINESS_DATE}::date
        ORDER BY "createdAt" ASC
      `,
      prisma.merchant.findMany({
        where: { assignedRepId: repId, OR: [{ businessName: { contains: "وجدي" } }, { businessName: { contains: "عمر" } }] },
        select: { id: true, businessName: true, contactPhone: true, status: true, createdAt: true },
      }),
    ]);

    console.log(`Orders this rep created on ${INCIDENT_BUSINESS_DATE} (${ordersThatDay.length}):`);
    console.log(JSON.stringify(ordersThatDay, null, 2));
    console.log(`\nPayments this rep collected on ${INCIDENT_BUSINESS_DATE} (${paymentsThatDay.length}):`);
    console.log(JSON.stringify(paymentsThatDay, null, 2));
    console.log(`\nMerchants assigned to this rep whose name contains "وجدي" or "عمر" (${nameMatches.length}):`);
    console.log(JSON.stringify(nameMatches, null, 2));

    const candidateMerchantIds = new Set<string>([
      ...(anchorOrder.merchantId ? [anchorOrder.merchantId] : []),
      ...nameMatches.map((m) => m.id),
      ...ordersThatDay.map((o) => o.merchantId).filter((id): id is string => Boolean(id)),
    ]);
    const candidateAccountIds = new Set<string>([
      ...(anchorOrder.accountId ? [anchorOrder.accountId] : []),
      ...ordersThatDay.map((o) => o.accountId).filter((id): id is string => Boolean(id)),
      ...paymentsThatDay.map((p) => p.accountId),
    ]);

    // ------------------------------------------------------------------
    // STEP 3 — every Order/AccountPayment/SalesReturn touching those
    // candidate accounts on the incident day — the REAL candidate pool,
    // built from relational evidence (merchant/account/rep), never from
    // "orderNumber/receiptNumber falls between 0006 and 0012".
    // ------------------------------------------------------------------
    section("STEP 3 — full relational record set for the candidate accounts");
    console.log(`Candidate merchant ids: ${[...candidateMerchantIds].join(", ") || "(none)"}`);
    const accountIds = [...candidateAccountIds];
    console.log(`Candidate account ids: ${accountIds.join(", ") || "(none)"}\n`);
    const [orders, payments, returns] = await Promise.all([
      prisma.order.findMany({
        where: { accountId: { in: accountIds } },
        orderBy: { createdAt: "asc" },
        select: {
          id: true,
          orderNumber: true,
          createdAt: true,
          status: true,
          source: true,
          totalCents: true,
          paidAmountCents: true,
          merchantId: true,
          accountId: true,
          createdByRepId: true,
          merchant: { select: { businessName: true } },
          account: { select: { merchantId: true } },
          initialPayment: { select: { id: true, receiptNumber: true, cancellation: { select: { id: true } } } },
          salesReturns: { select: { id: true, sequence: true, totalCreditCents: true, createdAt: true, reversal: { select: { id: true, reason: true, createdAt: true } } } },
        },
      }),
      prisma.accountPayment.findMany({
        where: { accountId: { in: accountIds } },
        orderBy: { createdAt: "asc" },
        select: {
          id: true,
          receiptNumber: true,
          createdAt: true,
          amountCents: true,
          method: true,
          origin: true,
          accountId: true,
          createdById: true,
          createdBy: { select: { name: true } },
          sourceOrderId: true,
          sourceOrder: { select: { orderNumber: true } },
          cancellation: { select: { id: true, reason: true, cancelledAt: true } },
          account: { select: { merchantId: true, merchant: { select: { businessName: true } } } },
        },
      }),
      prisma.salesReturn.findMany({
        where: { accountId: { in: accountIds } },
        orderBy: { createdAt: "asc" },
        select: {
          id: true,
          sequence: true,
          createdAt: true,
          totalCreditCents: true,
          accountId: true,
          orderId: true,
          order: { select: { orderNumber: true } },
          reversal: { select: { id: true, reason: true, createdAt: true, createdBy: { select: { name: true } } } },
        },
      }),
    ]);

    console.log(`Orders on candidate accounts (${orders.length}):`);
    for (const o of orders) {
      const invariant = o.merchantId === o.account?.merchantId ? "OK" : "*** MISMATCH ***";
      console.log(`  ${o.orderNumber} | ${o.createdAt.toISOString()} | status=${o.status} | total=${(o.totalCents / 100).toFixed(2)} | merchant=${o.merchant?.businessName ?? "—"} | invariant=${invariant}`);
    }
    console.log(`\nPayments on candidate accounts (${payments.length}):`);
    for (const p of payments) {
      console.log(`  ${p.receiptNumber ?? p.id} | ${p.createdAt.toISOString()} | amount=${(p.amountCents / 100).toFixed(2)} | origin=${p.origin ?? "legacy"} | account-merchant=${p.account.merchant?.businessName ?? "—"} | sourceOrder=${p.sourceOrder?.orderNumber ?? "—"} | cancelled=${Boolean(p.cancellation)}`);
    }
    console.log(`\nSalesReturns on candidate accounts (${returns.length}):`);
    for (const r of returns) {
      console.log(`  ${r.order.orderNumber}-R${r.sequence} | ${r.createdAt.toISOString()} | credit=${(r.totalCreditCents / 100).toFixed(2)} | reversed=${Boolean(r.reversal)}`);
    }

    // ------------------------------------------------------------------
    // STEP 4 — classification.
    // ------------------------------------------------------------------
    section("STEP 4 — classification (A = definite, B = ambiguous, C = unrelated)");
    const anchorOrderIds = new Set<string>([anchorOrder.id]);
    const categoryA: string[] = [];
    const categoryB: string[] = [];
    for (const o of orders) {
      const isAnchorItself = o.id === anchorOrder.id;
      const sameAccountAsAnchor = o.accountId === anchorOrder.accountId;
      const label = `Order ${o.orderNumber}`;
      if (isAnchorItself || (sameAccountAsAnchor && o.accountId)) {
        categoryA.push(`${label} — ${isAnchorItself ? "IS the anchor order" : "shares the anchor's own account (direct relational link)"}`);
      } else {
        categoryB.push(`${label} — same rep/day, different account (${o.merchant?.businessName ?? "—"}) — needs human confirmation it's the same incident`);
      }
    }
    for (const p of payments) {
      const label = `Payment ${p.receiptNumber ?? p.id}`;
      const linkedToAnchorOrder = p.sourceOrderId && anchorOrderIds.has(p.sourceOrderId);
      const sameAccountAsAnchor = p.accountId === anchorOrder.accountId;
      if (linkedToAnchorOrder || sameAccountAsAnchor) {
        categoryA.push(`${label} — ${linkedToAnchorOrder ? "linked to the anchor order via sourceOrderId" : "on the anchor's own account"}`);
      } else {
        categoryB.push(`${label} — same rep/day, different account (${p.account.merchant?.businessName ?? "—"}) — needs human confirmation`);
      }
    }
    for (const r of returns) {
      const label = `Return ${r.order.orderNumber}-R${r.sequence}`;
      if (r.orderId === anchorOrder.id || r.accountId === anchorOrder.accountId) {
        categoryA.push(`${label} — ${r.orderId === anchorOrder.id ? "IS the anchor return / another return of the anchor order" : "on the anchor's own account"}`);
      } else {
        categoryB.push(`${label} — same rep/day, different account — needs human confirmation`);
      }
    }
    console.log("A) DEFINITELY PART OF THE INCIDENT (relational link to the anchor order/account):");
    categoryA.forEach((entry) => console.log(`   - ${entry}`));
    console.log("\nB) POSSIBLY RELATED / AMBIGUOUS (same rep + same business day, but no direct relational link to the anchor — verify manually, e.g. by matching customer phone/name against عمر / وجدي):");
    categoryB.forEach((entry) => console.log(`   - ${entry}`));
    console.log("\nC) UNRELATED: everything else in this database whose order number or receipt number merely falls between the two anchor references numerically is EXCLUDED from A and B above on purpose — sequence-number proximity alone is never treated as evidence here.");

    // ------------------------------------------------------------------
    // STEP 5 — proposed (NOT executed) safe correction sequence + expected
    // effects, using only the existing reversal/correction architecture.
    // ------------------------------------------------------------------
    section("STEP 5 — PROPOSED correction sequence (PRINT ONLY — nothing below is executed)");
    for (const o of orders) {
      if (!categoryA.some((entry) => entry.startsWith(`Order ${o.orderNumber}`))) continue;
      console.log(`\n--- ${o.orderNumber} (status=${o.status}) ---`);

      const activeReturns = o.salesReturns.filter((r) => !r.reversal);
      for (const r of activeReturns) {
        console.log(`  1. reverseSalesReturn({ salesReturnId: "${r.id}" })  // ${o.orderNumber}-R${r.sequence}`);
        console.log(`     expected effect: merchant balance += ${(r.totalCreditCents / 100).toFixed(2)} ₪ ; REP_CAR stock -= the exact physical quantity that return added (blocked automatically if that stock is no longer there)`);
      }

      if (o.initialPayment && !o.initialPayment.cancellation) {
        console.log(`  2. This order's paid-now payment (${o.initialPayment.receiptNumber ?? o.initialPayment.id}) is origin=SALE_INITIAL — it is reversed AS PART OF correctSale below, not via cancelManualPayment directly.`);
      }

      const stillHasActiveReturn = activeReturns.length > 0;
      if (stillHasActiveReturn) {
        console.log(`  3. correctSale is BLOCKED until step 1 completes for every return above (ORDER_HAS_SALES_RETURNS) — order left as-is until then.`);
      } else if (isTerminalOrderStatus(o.status)) {
        console.log(`  3. Order is already terminal (${o.status}) — no further order-status correction needed.`);
      } else {
        const validNext = getValidNextOrderStatuses(o.status, o.source);
        const canCancel = validNext.includes(ORDER_STATUSES.CANCELLED);
        console.log(`  3. correctSale({ orderNumber: "${o.orderNumber}", reason: "<مطلوب>" })  // valid next statuses from here: ${validNext.join(", ") || "(none)"}${canCancel ? "" : " — CANCELLED is not directly reachable from this status; inspect manually"}`);
        console.log(`     expected effect: order total ${(o.totalCents / 100).toFixed(2)} ₪ stops counting toward the account balance; its stock is restored to its own stockLocationId; its own paid-now payment (if any) is cancelled in the same step`);
      }
    }

    console.log("\nNothing above was executed. Re-run this same script AFTER applying corrections through the normal ADMIN UI to confirm the expected effects actually landed.");
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
