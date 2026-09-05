import "server-only";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { getAccountBalanceCents } from "@/lib/accounts";
import { MERCHANT_STATUSES } from "@/lib/constants";

type Tx = Prisma.TransactionClient;

export interface RepMerchantSummary {
  id: string;
  businessName: string;
  region: string | null;
  phone: string | null;
  status: string;
  balanceCents: number;
}

/** Merchants assigned to a given rep (Merchant.assignedRepId), each with its
 * live account balance via the same getAccountBalanceCents formula the
 * admin accounts pages use — never a separately stored total. Pass `region`
 * to narrow to merchants sharing that exact region label. */
export async function getMerchantsForRep(repId: string, region?: string): Promise<RepMerchantSummary[]> {
  const merchants = await prisma.merchant.findMany({
    where: {
      assignedRepId: repId,
      ...(region ? { region } : {}),
    },
    orderBy: { businessName: "asc" },
    select: {
      id: true,
      businessName: true,
      region: true,
      status: true,
      contactPhone: true,
      user: { select: { phone: true } },
      account: {
        select: {
          openingBalanceCents: true,
          orders: { select: { status: true, totalCents: true } },
          payments: { select: { amountCents: true } },
        },
      },
    },
  });

  return merchants.map((merchant) => ({
    id: merchant.id,
    businessName: merchant.businessName,
    region: merchant.region,
    phone: merchant.contactPhone ?? merchant.user?.phone ?? null,
    status: merchant.status,
    balanceCents: merchant.account ? getAccountBalanceCents(merchant.account) : 0,
  }));
}

/** Distinct region labels among a rep's assigned merchants, for the
 * /rep/merchants filter dropdown. */
export async function getRepMerchantRegions(repId: string): Promise<string[]> {
  const rows = await prisma.merchant.findMany({
    where: { assignedRepId: repId, region: { not: null } },
    select: { region: true },
    distinct: ["region"],
    orderBy: { region: "asc" },
  });

  return rows.map((row) => row.region).filter((value): value is string => Boolean(value));
}

export interface RepTraderContact {
  /** The stable Merchant.id — present because every entry here already IS a
   * real Merchant row (see below). AssignStockForm's trader picker uses
   * this directly instead of re-resolving by phone once a trader is picked
   * (see resolveOrCreateRepMerchant / requirement G on not re-deriving a
   * known identity). NewSaleForm's own customer picker doesn't need this
   * field and simply ignores it — createRepSale still always resolves by
   * phone there, unchanged. */
  id: string;
  name: string;
  phone: string;
  city: string | null;
  address: string | null;
  /** This trader's live account balance (opening balance + orders -
   * payments — see getAccountBalanceCents), computed from the SAME nested
   * `account` select as getMerchantsForRep, so listing a rep's contacts
   * never costs an extra query per trader. Lets NewSaleForm show "الذمة
   * الحالية على التاجر" the instant the rep picks a known contact, entirely
   * from data already scoped to this rep — no separate lookup/action
   * needed. 0 for a trader with no account yet (never sold to before). */
  currentBalanceCents: number;
}

/** Contact-autofill list for a rep-facing customer/trader search (see
 * NewSaleForm.tsx and AssignStockForm.tsx) — every trader assigned to this
 * rep, whether a real login-based merchant or a login-less trader quick-added
 * by this rep during a past sale/customer-order (see createRepSale /
 * resolveOrCreateRepMerchant). Only traders with a known phone are included,
 * since phone is how that resolution later re-identifies the same trader
 * instead of creating a duplicate. */
export async function getRepTraderContactsForSaleForm(repId: string): Promise<RepTraderContact[]> {
  const merchants = await prisma.merchant.findMany({
    where: { assignedRepId: repId },
    orderBy: { businessName: "asc" },
    select: {
      id: true,
      businessName: true,
      contactPhone: true,
      city: true,
      address: true,
      user: { select: { phone: true } },
      account: {
        select: {
          openingBalanceCents: true,
          orders: { select: { status: true, totalCents: true } },
          payments: { select: { amountCents: true } },
        },
      },
    },
  });

  return merchants
    .map((merchant) => ({
      id: merchant.id,
      name: merchant.businessName,
      phone: merchant.contactPhone ?? merchant.user?.phone ?? null,
      city: merchant.city,
      address: merchant.address,
      currentBalanceCents: merchant.account ? getAccountBalanceCents(merchant.account) : 0,
    }))
    .filter((merchant): merchant is RepTraderContact => Boolean(merchant.phone));
}

export interface ResolveRepMerchantInput {
  salesRepId: string;
  businessName: string;
  contactPhone: string;
  city?: string | null;
  address?: string | null;
}

/** Resolves this rep's real trader identity by phone — reuses whichever
 * Merchant already matches (self-registered, added by an admin, or created
 * by this rep on an earlier sale/customer-order), regardless of whether it
 * has a login; creates a new login-less trader (approved immediately,
 * assigned to this rep, visible in /admin/merchants right away) only when no
 * match exists. This is the exact identity rule createRepSale already used
 * inline (src/app/rep/sales/actions.ts) — extracted here so every flow that
 * needs to attach a real trader identity to a rep's activity resolves the
 * SAME Merchant instead of a second, inconsistent one. Must run inside the
 * caller's own transaction, and never creates a duplicate: two calls with
 * the same rep+phone always return the same Merchant.id. */
export async function resolveOrCreateRepMerchant(tx: Tx, input: ResolveRepMerchantInput): Promise<{ id: string; userId: string | null; status: string }> {
  const existing = await tx.merchant.findFirst({
    where: {
      assignedRepId: input.salesRepId,
      OR: [{ contactPhone: input.contactPhone }, { user: { phone: input.contactPhone } }],
    },
    select: { id: true, userId: true, status: true },
  });
  if (existing) return existing;

  return tx.merchant.create({
    data: {
      businessName: input.businessName,
      contactPhone: input.contactPhone,
      city: input.city,
      address: input.address,
      assignedRepId: input.salesRepId,
      status: MERCHANT_STATUSES.APPROVED,
      approvedAt: new Date(),
    },
    select: { id: true, userId: true, status: true },
  });
}

export interface RepMerchantsFleetSummary {
  merchantCount: number;
  totalBalanceCents: number;
}

/** Rep dashboard summary card data — count of assigned merchants and their
 * combined outstanding balance. */
export async function getRepMerchantsFleetSummary(repId: string): Promise<RepMerchantsFleetSummary> {
  const merchants = await getMerchantsForRep(repId);
  return {
    merchantCount: merchants.length,
    totalBalanceCents: merchants.reduce((sum, merchant) => sum + Math.max(merchant.balanceCents, 0), 0),
  };
}
