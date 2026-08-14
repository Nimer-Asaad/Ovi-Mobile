import "server-only";
import { prisma } from "@/lib/prisma";
import { getAccountBalanceCents } from "@/lib/accounts";

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
  name: string;
  phone: string;
  city: string | null;
  address: string | null;
}

/** Contact-autofill list for the rep sale form's customer-name search (see
 * NewSaleForm.tsx) — every trader assigned to this rep, whether a real
 * login-based merchant or a login-less trader quick-added by this rep
 * during a past sale (see createRepSale). Only traders with a known phone
 * are included, since phone is how createRepSale later re-identifies the
 * same trader instead of creating a duplicate. */
export async function getRepTraderContactsForSaleForm(repId: string): Promise<RepTraderContact[]> {
  const merchants = await prisma.merchant.findMany({
    where: { assignedRepId: repId },
    orderBy: { businessName: "asc" },
    select: {
      businessName: true,
      contactPhone: true,
      city: true,
      address: true,
      user: { select: { phone: true } },
    },
  });

  return merchants
    .map((merchant) => ({
      name: merchant.businessName,
      phone: merchant.contactPhone ?? merchant.user?.phone ?? null,
      city: merchant.city,
      address: merchant.address,
    }))
    .filter((merchant): merchant is RepTraderContact => Boolean(merchant.phone));
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
