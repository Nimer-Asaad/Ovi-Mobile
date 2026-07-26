import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { Input } from "@/components/ui/Input";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { PageHeader } from "@/components/ui/PageHeader";
import { AdminTable, AdminTableHead, AdminTableBody, AdminEmptyRow } from "@/components/admin/AdminTable";
import { formatCurrencyFromCents } from "@/lib/utils";
import { getAccountBalanceCents, getNewOrderHrefForAccount } from "@/lib/accounts";

interface AdminAccountsPageProps {
  searchParams: Promise<{ q?: string }>;
}

export default async function AdminAccountsPage({ searchParams }: AdminAccountsPageProps) {
  const { q } = await searchParams;
  const trimmedQuery = q?.trim();

  const accounts = await prisma.customerAccount.findMany({
    where: {
      isActive: true,
      ...(trimmedQuery
        ? {
            OR: [
              { displayName: { contains: trimmedQuery, mode: "insensitive" as const } },
              { phone: { contains: trimmedQuery, mode: "insensitive" as const } },
              { merchant: { businessName: { contains: trimmedQuery, mode: "insensitive" as const } } },
              { customer: { name: { contains: trimmedQuery, mode: "insensitive" as const } } },
              { customer: { email: { contains: trimmedQuery, mode: "insensitive" as const } } },
            ],
          }
        : {}),
    },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      displayName: true,
      phone: true,
      merchant: { select: { id: true, businessName: true } },
      customer: { select: { id: true, name: true } },
      orders: { select: { status: true, totalCents: true } },
      payments: { select: { amountCents: true } },
    },
  });

  const rows = accounts.map((account) => ({
    id: account.id,
    displayName: account.displayName,
    phone: account.phone,
    kindLabel: account.merchant ? "تاجر جملة" : account.customer ? "عميل مسجّل" : "عميل مباشر",
    balanceCents: getAccountBalanceCents(account),
    newOrderHref: getNewOrderHrefForAccount(account.id, {
      merchantId: account.merchant?.id ?? null,
      customerId: account.customer?.id ?? null,
    }),
  }));

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="الحسابات"
        subtitle="متابعة ديون ودفعات التجار والعملاء المباشرين"
        actions={
          <Link href="/admin/accounts/new">
            <Button>حساب عميل مباشر جديد</Button>
          </Link>
        }
      />

      <form method="GET" className="rounded-card border border-navy-soft bg-navy-surface p-4">
        <Input name="q" label="بحث بالاسم أو الهاتف أو الاسم التجاري أو البريد الإلكتروني" defaultValue={trimmedQuery ?? ""} />
      </form>

      <AdminTable>
        <AdminTableHead>
          <th className="px-4 py-3 text-start">الاسم</th>
          <th className="px-4 py-3 text-start">الهاتف</th>
          <th className="px-4 py-3 text-start">النوع</th>
          <th className="px-4 py-3 text-start">الرصيد المستحق</th>
          <th className="px-4 py-3 text-start"></th>
        </AdminTableHead>
        <AdminTableBody>
          {rows.map((account) => (
            <tr key={account.id}>
              <td className="px-4 py-3 text-neutral-bg">{account.displayName}</td>
              <td className="px-4 py-3 text-neutral-bg/70">{account.phone ?? "—"}</td>
              <td className="px-4 py-3">
                <Badge variant="neutral">{account.kindLabel}</Badge>
              </td>
              <td className="px-4 py-3">
                <span
                  className={
                    account.balanceCents > 0
                      ? "font-semibold text-rose-600"
                      : "text-neutral-bg/70"
                  }
                >
                  {formatCurrencyFromCents(Math.max(account.balanceCents, 0))}
                </span>
              </td>
              <td className="px-4 py-3">
                <div className="flex items-center gap-3">
                  <Link href={account.newOrderHref}>
                    <Button size="sm">طلبية جديدة</Button>
                  </Link>
                  <Link href={`/admin/accounts/${account.id}`} className="text-sm text-gold-champagne hover:underline">
                    التفاصيل
                  </Link>
                </div>
              </td>
            </tr>
          ))}
          {rows.length === 0 && <AdminEmptyRow colSpan={5} message="لا توجد حسابات مطابقة" />}
        </AdminTableBody>
      </AdminTable>
    </div>
  );
}
