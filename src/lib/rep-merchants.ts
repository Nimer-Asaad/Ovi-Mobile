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
    phone: merchant.user.phone,
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
