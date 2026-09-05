import Link from "next/link";
import { requireRole } from "@/lib/auth/guards";
import { ROLES } from "@/lib/constants";
import { prisma } from "@/lib/prisma";
import { PageHeader } from "@/components/ui/PageHeader";
import { Input } from "@/components/ui/Input";
import { Select } from "@/components/ui/Select";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { formatCurrencyFromCents } from "@/lib/utils";
import { MERCHANT_STATUSES } from "@/lib/constants";
import { getMerchantStatusLabel, getMerchantStatusBadgeVariant } from "@/lib/merchant-labels";
import { getMerchantsForRep, getRepMerchantRegions } from "@/lib/rep-merchants";

interface RepMerchantsPageProps {
  searchParams: Promise<{ region?: string; q?: string }>;
}

/** Merchants assigned to the signed-in rep (Merchant.assignedRepId) — see
 * getMerchantsForRep in src/lib/rep-merchants.ts. Mobile-first card list
 * (not the desktop AdminTable pattern): a rep works this page primarily
 * from a phone, so each merchant is one tall, thumb-friendly card with a
 * large readable balance and full-width action buttons, never a
 * horizontally-scrolling table. Search/region filtering happens
 * server-side via a plain GET form, same convention as every other
 * search+filter page in this app. */
export default async function RepMerchantsPage({ searchParams }: RepMerchantsPageProps) {
  const user = await requireRole([ROLES.SALES_REPRESENTATIVE]);
  const { region, q } = await searchParams;
  const trimmedQuery = q?.trim().toLowerCase();

  const rep = await prisma.salesRepresentative.findUnique({
    where: { userId: user.id },
    select: { id: true },
  });

  const [allMerchants, regions] = rep
    ? await Promise.all([getMerchantsForRep(rep.id, region), getRepMerchantRegions(rep.id)])
    : [[], []];

  const merchants = trimmedQuery
    ? allMerchants.filter(
        (merchant) => merchant.businessName.toLowerCase().includes(trimmedQuery) || (merchant.phone ?? "").toLowerCase().includes(trimmedQuery),
      )
    : allMerchants;

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="التجار" subtitle="التجار المعينون لك — بيع، تسجيل دفعة، أو مراجعة كشف الحساب" />

      <form method="GET" className="grid grid-cols-1 gap-3 rounded-card border border-navy-soft bg-navy-surface p-4 sm:grid-cols-3">
        <Input name="q" label="ابحث بالاسم أو الهاتف" defaultValue={q ?? ""} placeholder="اسم التاجر أو رقم الهاتف..." />
        {regions.length > 0 && (
          <Select name="region" label="المنطقة" defaultValue={region ?? ""}>
            <option value="">كل المناطق</option>
            {regions.map((value) => (
              <option key={value} value={value}>
                {value}
              </option>
            ))}
          </Select>
        )}
        <div className="flex items-end">
          <Button type="submit" className="w-full sm:w-auto">
            تصفية
          </Button>
        </div>
      </form>

      {merchants.length === 0 ? (
        <p className="rounded-card border border-navy-soft bg-navy-surface p-6 text-center text-sm text-neutral-bg/60">
          {allMerchants.length === 0 ? "لا يوجد تجار معينون لك بعد" : "لا توجد نتائج مطابقة"}
        </p>
      ) : (
        <div className="flex flex-col gap-3">
          {merchants.map((merchant) => (
            <div key={merchant.id} className="flex flex-col gap-3 rounded-card border border-navy-soft bg-navy-surface p-4">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="whitespace-normal break-words text-base font-semibold text-neutral-bg">{merchant.businessName}</p>
                  <p className="mt-0.5 text-sm text-neutral-bg/60">
                    {merchant.phone ?? "بدون رقم هاتف"}
                    {merchant.region && ` — ${merchant.region}`}
                  </p>
                </div>
                <Badge variant={getMerchantStatusBadgeVariant(merchant.status)}>{getMerchantStatusLabel(merchant.status)}</Badge>
              </div>

              <div className="rounded-card bg-navy-deep/40 px-4 py-3">
                <p className="text-xs text-neutral-bg/50">الرصيد المستحق</p>
                <p className={`text-2xl font-bold ${merchant.balanceCents > 0 ? "text-rose-400" : "text-emerald-400"}`}>
                  {formatCurrencyFromCents(Math.max(merchant.balanceCents, 0))}
                </p>
              </div>

              <div className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap">
                {merchant.status === MERCHANT_STATUSES.APPROVED ? (
                  <Link href={`/rep/sales/new?merchantId=${merchant.id}`} className="w-full sm:w-auto">
                    <Button size="sm" className="w-full">
                      بيع للتاجر
                    </Button>
                  </Link>
                ) : (
                  <Button size="sm" className="w-full" disabled title="التاجر موقوف حالياً ولا يمكن البيع له">
                    بيع للتاجر
                  </Button>
                )}
                <Link href={`/rep/merchants/${merchant.id}#payment`} className="w-full sm:w-auto">
                  <Button size="sm" variant="outline" className="w-full">
                    تسجيل دفعة
                  </Button>
                </Link>
                <Link href={`/rep/merchants/${merchant.id}/statement`} className="w-full sm:w-auto">
                  <Button size="sm" variant="outline" className="w-full">
                    كشف الحساب
                  </Button>
                </Link>
                <Link href={`/rep/merchants/${merchant.id}`} className="w-full sm:w-auto">
                  <Button size="sm" variant="ghost" className="w-full">
                    تفاصيل التاجر
                  </Button>
                </Link>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
