import Link from "next/link";
import { requireRole } from "@/lib/auth/guards";
import { ROLES } from "@/lib/constants";
import { prisma } from "@/lib/prisma";
import { PageHeader } from "@/components/ui/PageHeader";
import { Select } from "@/components/ui/Select";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { AdminTable, AdminTableHead, AdminTableBody, AdminEmptyRow } from "@/components/admin/AdminTable";
import { formatCurrencyFromCents } from "@/lib/utils";
import { getMerchantStatusLabel, getMerchantStatusBadgeVariant } from "@/lib/merchant-labels";
import { getMerchantsForRep, getRepMerchantRegions } from "@/lib/rep-merchants";

interface RepMerchantsPageProps {
  searchParams: Promise<{ region?: string }>;
}

/** Merchants assigned to the signed-in rep (Merchant.assignedRepId), with a
 * region filter and a link to each merchant's account statement — see
 * getMerchantsForRep in src/lib/rep-merchants.ts. */
export default async function RepMerchantsPage({ searchParams }: RepMerchantsPageProps) {
  const user = await requireRole([ROLES.SALES_REPRESENTATIVE]);
  const { region } = await searchParams;

  const rep = await prisma.salesRepresentative.findUnique({
    where: { userId: user.id },
    select: { id: true },
  });

  const [merchants, regions] = rep
    ? await Promise.all([getMerchantsForRep(rep.id, region), getRepMerchantRegions(rep.id)])
    : [[], []];

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="التجار" subtitle="التجار المعينون لك — تصفح كشف حساب كل تاجر" />

      {regions.length > 0 && (
        <form
          method="GET"
          className="grid grid-cols-1 gap-4 rounded-card border border-navy-soft bg-navy-surface p-4 sm:grid-cols-3"
        >
          <Select name="region" label="المنطقة" defaultValue={region ?? ""}>
            <option value="">كل المناطق</option>
            {regions.map((value) => (
              <option key={value} value={value}>
                {value}
              </option>
            ))}
          </Select>
          <div className="flex items-end">
            <Button type="submit">تصفية</Button>
          </div>
        </form>
      )}

      <AdminTable>
        <AdminTableHead>
          <th className="px-4 py-3 text-start">الاسم التجاري</th>
          <th className="px-4 py-3 text-start">المنطقة</th>
          <th className="px-4 py-3 text-start">الهاتف</th>
          <th className="px-4 py-3 text-start">الحالة</th>
          <th className="px-4 py-3 text-start">الرصيد المستحق</th>
          <th className="px-4 py-3 text-start"></th>
        </AdminTableHead>
        <AdminTableBody>
          {merchants.map((merchant) => (
            <tr key={merchant.id}>
              <td className="px-4 py-3 text-neutral-bg">{merchant.businessName}</td>
              <td className="px-4 py-3 text-neutral-bg/70">{merchant.region ?? "—"}</td>
              <td className="px-4 py-3 text-neutral-bg/70">{merchant.phone ?? "—"}</td>
              <td className="px-4 py-3">
                <Badge variant={getMerchantStatusBadgeVariant(merchant.status)}>
                  {getMerchantStatusLabel(merchant.status)}
                </Badge>
              </td>
              <td className="px-4 py-3 text-neutral-bg/70">
                {formatCurrencyFromCents(Math.max(merchant.balanceCents, 0))}
              </td>
              <td className="px-4 py-3">
                <Link href={`/rep/merchants/${merchant.id}`} className="text-sm text-gold-champagne hover:underline">
                  كشف الحساب
                </Link>
              </td>
            </tr>
          ))}
          {merchants.length === 0 && <AdminEmptyRow colSpan={6} message="لا يوجد تجار معينون لك بعد" />}
        </AdminTableBody>
      </AdminTable>
    </div>
  );
}
