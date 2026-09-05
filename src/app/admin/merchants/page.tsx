import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { Input } from "@/components/ui/Input";
import { Select } from "@/components/ui/Select";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { PageHeader } from "@/components/ui/PageHeader";
import { AdminTable, AdminTableHead, AdminTableBody, AdminEmptyRow } from "@/components/admin/AdminTable";
import { formatCurrencyFromCents } from "@/lib/utils";
import { MERCHANT_STATUSES } from "@/lib/constants";
import { getMerchantStatusLabel, getMerchantStatusBadgeVariant } from "@/lib/merchant-labels";
import { getAccountBalanceCents } from "@/lib/accounts";

interface AdminMerchantsPageProps {
  searchParams: Promise<{ q?: string; status?: string; region?: string; assignedRepId?: string; debt?: string }>;
}

export default async function AdminMerchantsPage({ searchParams }: AdminMerchantsPageProps) {
  const { q, status, region, assignedRepId, debt } = await searchParams;
  const trimmedQuery = q?.trim();

  const [merchants, regionRows, reps] = await Promise.all([
    prisma.merchant.findMany({
      where: {
        ...(status ? { status } : {}),
        ...(region ? { region } : {}),
        ...(assignedRepId ? { assignedRepId } : {}),
        ...(trimmedQuery
          ? {
              OR: [
                { businessName: { contains: trimmedQuery, mode: "insensitive" as const } },
                { contactName: { contains: trimmedQuery, mode: "insensitive" as const } },
                { contactPhone: { contains: trimmedQuery, mode: "insensitive" as const } },
                { whatsappPhone: { contains: trimmedQuery, mode: "insensitive" as const } },
                { city: { contains: trimmedQuery, mode: "insensitive" as const } },
                { user: { name: { contains: trimmedQuery, mode: "insensitive" as const } } },
                { user: { email: { contains: trimmedQuery, mode: "insensitive" as const } } },
                { user: { phone: { contains: trimmedQuery, mode: "insensitive" as const } } },
              ],
            }
          : {}),
      },
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        businessName: true,
        contactName: true,
        region: true,
        city: true,
        status: true,
        createdAt: true,
        contactPhone: true,
        assignedRep: { select: { user: { select: { name: true } } } },
        user: { select: { name: true, email: true, phone: true } },
        account: {
          select: {
            openingBalanceCents: true,
            orders: { select: { status: true, totalCents: true } },
            payments: { select: { amountCents: true } },
          },
        },
      },
    }),
    prisma.merchant.findMany({
      where: { region: { not: null } },
      select: { region: true },
      distinct: ["region"],
      orderBy: { region: "asc" },
    }),
    prisma.salesRepresentative.findMany({
      where: { isActive: true },
      orderBy: { user: { name: "asc" } },
      select: { id: true, employeeCode: true, user: { select: { name: true } } },
    }),
  ]);

  const regions = regionRows.map((row) => row.region).filter((value): value is string => Boolean(value));
  const repOptions = reps.map((rep) => ({ id: rep.id, label: `${rep.user.name} (${rep.employeeCode})` }));

  let rows = merchants.map((merchant) => ({
    ...merchant,
    balanceCents: merchant.account ? getAccountBalanceCents(merchant.account) : 0,
  }));

  if (debt === "indebted") {
    rows = rows.filter((row) => row.balanceCents > 0);
  } else if (debt === "zero") {
    rows = rows.filter((row) => row.balanceCents <= 0);
  }

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="التجار"
        subtitle="إدارة بيانات التجار، ديونهم، وحالتهم"
        actions={
          <Link href="/admin/merchants/new">
            <Button>إضافة تاجر</Button>
          </Link>
        }
      />

      <form
        method="GET"
        className="grid grid-cols-1 gap-4 rounded-card border border-navy-soft bg-navy-surface p-4 sm:grid-cols-2 lg:grid-cols-5"
      >
        <div className="lg:col-span-2">
          <Input name="q" label="بحث بالاسم أو صاحب المحل أو الهاتف أو واتساب أو المدينة" defaultValue={trimmedQuery ?? ""} />
        </div>

        <Select name="status" label="الحالة" defaultValue={status ?? ""}>
          <option value="">كل الحالات</option>
          <option value={MERCHANT_STATUSES.PENDING}>{getMerchantStatusLabel(MERCHANT_STATUSES.PENDING)}</option>
          <option value={MERCHANT_STATUSES.APPROVED}>{getMerchantStatusLabel(MERCHANT_STATUSES.APPROVED)}</option>
          <option value={MERCHANT_STATUSES.SUSPENDED}>{getMerchantStatusLabel(MERCHANT_STATUSES.SUSPENDED)}</option>
          <option value={MERCHANT_STATUSES.REJECTED}>{getMerchantStatusLabel(MERCHANT_STATUSES.REJECTED)}</option>
        </Select>

        <Select name="assignedRepId" label="المندوب" defaultValue={assignedRepId ?? ""}>
          <option value="">كل المندوبين</option>
          {repOptions.map((rep) => (
            <option key={rep.id} value={rep.id}>
              {rep.label}
            </option>
          ))}
        </Select>

        <Select name="region" label="المنطقة" defaultValue={region ?? ""}>
          <option value="">كل المناطق</option>
          {regions.map((value) => (
            <option key={value} value={value}>
              {value}
            </option>
          ))}
        </Select>

        <Select name="debt" label="الرصيد" defaultValue={debt ?? ""}>
          <option value="">الكل</option>
          <option value="indebted">عليه دين</option>
          <option value="zero">لا يوجد دين</option>
        </Select>

        <div className="flex items-end lg:col-span-5">
          <Button type="submit">تصفية</Button>
        </div>
      </form>

      <AdminTable>
        <AdminTableHead>
          <th className="px-4 py-3 text-start">اسم المحل</th>
          <th className="px-4 py-3 text-start">صاحب المحل</th>
          <th className="px-4 py-3 text-start">الهاتف</th>
          <th className="px-4 py-3 text-start">المدينة / المنطقة</th>
          <th className="px-4 py-3 text-start">المندوب</th>
          <th className="px-4 py-3 text-start">الرصيد</th>
          <th className="px-4 py-3 text-start">الحالة</th>
          <th className="px-4 py-3 text-start"></th>
        </AdminTableHead>
        <AdminTableBody>
          {rows.map((merchant) => (
            <tr key={merchant.id}>
              <td className="max-w-[16rem] whitespace-normal break-words px-4 py-3 text-neutral-bg">{merchant.businessName}</td>
              <td className="px-4 py-3 text-neutral-bg/70">{merchant.contactName ?? merchant.user?.name ?? "—"}</td>
              <td className="px-4 py-3 text-neutral-bg/70">{merchant.contactPhone ?? merchant.user?.phone ?? "—"}</td>
              <td className="px-4 py-3 text-neutral-bg/70">{[merchant.city, merchant.region].filter(Boolean).join(" / ") || "—"}</td>
              <td className="px-4 py-3 text-neutral-bg/70">{merchant.assignedRep?.user.name ?? "—"}</td>
              <td className="px-4 py-3">
                <span className={merchant.balanceCents > 0 ? "font-semibold text-rose-400" : "text-neutral-bg/70"}>
                  {formatCurrencyFromCents(Math.max(merchant.balanceCents, 0))}
                </span>
              </td>
              <td className="px-4 py-3">
                <Badge variant={getMerchantStatusBadgeVariant(merchant.status)}>
                  {getMerchantStatusLabel(merchant.status)}
                </Badge>
              </td>
              <td className="px-4 py-3">
                <div className="flex flex-wrap items-center gap-2">
                  <Link href={`/admin/merchants/${merchant.id}`} className="text-sm text-gold-champagne hover:underline">
                    التفاصيل
                  </Link>
                  <Link href={`/admin/merchants/${merchant.id}/edit`} className="text-sm text-gold-champagne hover:underline">
                    تعديل
                  </Link>
                </div>
              </td>
            </tr>
          ))}
          {rows.length === 0 && <AdminEmptyRow colSpan={8} message="لا يوجد تجار مطابقون" />}
        </AdminTableBody>
      </AdminTable>
    </div>
  );
}
