import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { Input } from "@/components/ui/Input";
import { Button } from "@/components/ui/Button";
import { PageHeader } from "@/components/ui/PageHeader";
import { AdminTable, AdminTableHead, AdminTableBody, AdminEmptyRow } from "@/components/admin/AdminTable";
import { formatCurrencyFromCents } from "@/lib/utils";
import { getMerchantStatusLabel, getMerchantStatusBadgeVariant } from "@/lib/merchant-labels";
import { getAccountBalanceCents } from "@/lib/accounts";
import { previewMerchantMerge } from "@/lib/merchant-merge";
import { MerchantMergeConfirmForm } from "@/components/admin/merchants/MerchantMergeConfirmForm";

interface AdminMerchantMergePageProps {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ q?: string; sourceId?: string }>;
}

const CANDIDATE_SELECT = {
  id: true,
  businessName: true,
  contactPhone: true,
  whatsappPhone: true,
  status: true,
  assignedRep: { select: { user: { select: { name: true } } } },
  user: { select: { phone: true } },
  account: {
    select: {
      openingBalanceCents: true,
      orders: { select: { status: true, totalCents: true } },
      payments: { select: { amountCents: true, cancellation: { select: { id: true } } } },
      salesReturns: { select: { totalCreditCents: true, reversal: { select: { id: true } } } },
    },
  },
} as const;

/** دمج تاجر مكرر — merges a duplicate merchant record into this page's own
 * merchant (always TARGET — the canonical record that survives). ADMIN-only
 * via /admin/merchants's own nested layout; the
 * mutating action independently re-checks ADMIN regardless (see
 * ./actions.ts). Two-step flow, both GET-driven (no client JS needed until
 * the final confirm): pick a SOURCE via search, then review the "قبل
 * الدمج"/"بعد الدمج" figures before the one destructive submit. */
export default async function AdminMerchantMergePage({ params, searchParams }: AdminMerchantMergePageProps) {
  const { id: targetMerchantId } = await params;
  const { q, sourceId } = await searchParams;
  const trimmedQuery = q?.trim();

  const target = await prisma.merchant.findUnique({ where: { id: targetMerchantId }, select: { id: true, businessName: true } });
  if (!target) {
    notFound();
  }

  if (sourceId) {
    let preview;
    try {
      preview = await previewMerchantMerge(prisma, sourceId, targetMerchantId);
    } catch {
      notFound();
    }

    const isConflict = preview.loginTransferPlan.kind === "CONFLICT";
    const isTransfer = preview.loginTransferPlan.kind === "TRANSFER";

    return (
      <div className="flex flex-col gap-6">
        <PageHeader title="دمج تاجر مكرر" subtitle={`سيتم الدمج مع: ${target.businessName}`} />

        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          <MergePartyCard title="التاجر المكرر (سيتم إيقافه)" name={preview.source.businessName} status={preview.source.status} figures={preview.sourceFigures} />
          <MergePartyCard title="سيتم دمجه مع" name={preview.target.businessName} status={preview.target.status} figures={preview.targetFigures} />
        </div>

        <Card className="border-gold-champagne/40 bg-gold-champagne/5">
          <CardHeader>
            <CardTitle>بعد الدمج</CardTitle>
          </CardHeader>
          <CardContent className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <MiniStat label="التاجر الذي سيبقى" value={preview.target.businessName} />
            <MiniStat label="إجمالي عدد الفواتير" value={String(preview.expectedAfter.orderCount)} />
            <MiniStat label="إجمالي المبيعات" value={formatCurrencyFromCents(preview.expectedAfter.salesTotalCents)} />
            <MiniStat
              label="الرصيد المتوقع بعد الدمج"
              value={formatCurrencyFromCents(preview.expectedAfter.balanceCents)}
              emphasize
            />
          </CardContent>
        </Card>

        {isConflict && (
          <div className="rounded-card border border-rose-500/40 bg-rose-500/10 p-4 text-sm font-medium text-rose-800">
            لا يمكن دمج التاجرين تلقائياً لأن كلا السجلين مرتبطان بحساب دخول مختلف.
          </div>
        )}

        {isTransfer && (
          <div className="rounded-card border border-amber-500/40 bg-amber-500/10 p-4 text-sm text-amber-800">
            تنبيه: التاجر المكرر مرتبط بحساب دخول (بريد إلكتروني/كلمة مرور). بعد الدمج، سيُنقل حساب الدخول هذا تلقائياً إلى
            التاجر الأساسي — عند تسجيل الدخول من صفحة &ldquo;حسابي&rdquo; سيظهر سجل الطلبات الكامل (المدموج) تحت التاجر
            الأساسي، ولن يبقى مرتبطاً بالسجل المكرر الموقوف.
          </div>
        )}

        <Card>
          <CardContent className="flex flex-col gap-4">
            <p className="text-sm text-neutral-bg/70">
              سيتم نقل جميع مبيعات ودفعات وذمة التاجر المكرر إلى التاجر الأساسي. لا تنفذ العملية إلا إذا كنت متأكداً أن
              السجلين لنفس التاجر.
            </p>
            <div className="flex flex-wrap items-center gap-3">
              {!isConflict && (
                <MerchantMergeConfirmForm targetMerchantId={targetMerchantId} sourceMerchantId={sourceId} sourceName={preview.source.businessName} targetName={preview.target.businessName} />
              )}
              <Link href={`/admin/merchants/${targetMerchantId}/merge`} className="text-sm text-neutral-bg/60 hover:underline">
                اختيار تاجر آخر
              </Link>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  const candidates = await prisma.merchant.findMany({
    where: {
      id: { not: targetMerchantId },
      ...(trimmedQuery
        ? {
            OR: [
              { businessName: { contains: trimmedQuery, mode: "insensitive" as const } },
              { contactPhone: { contains: trimmedQuery, mode: "insensitive" as const } },
              { whatsappPhone: { contains: trimmedQuery, mode: "insensitive" as const } },
              { user: { phone: { contains: trimmedQuery, mode: "insensitive" as const } } },
            ],
          }
        : {}),
    },
    orderBy: { businessName: "asc" },
    take: 25,
    select: CANDIDATE_SELECT,
  });

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="دمج تاجر مكرر" subtitle={`التاجر الأساسي: ${target.businessName}`} />

      <Card>
        <CardHeader>
          <CardTitle>التاجر المكرر المراد دمجه</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <form method="GET" className="flex flex-wrap items-end gap-3">
            <div className="min-w-64 flex-1">
              <Input name="q" label="ابحث بالاسم أو الهاتف" defaultValue={q ?? ""} placeholder="اسم المحل أو رقم الهاتف" />
            </div>
            <Button type="submit">بحث</Button>
          </form>

          <AdminTable>
            <AdminTableHead>
              <th className="px-4 py-3 text-start">اسم المحل</th>
              <th className="px-4 py-3 text-start">الهاتف</th>
              <th className="px-4 py-3 text-start">المندوب</th>
              <th className="px-4 py-3 text-start">الحالة</th>
              <th className="px-4 py-3 text-start">الرصيد الحالي</th>
              <th className="px-4 py-3 text-end"></th>
            </AdminTableHead>
            <AdminTableBody>
              {candidates.map((candidate) => {
                const balanceCents = candidate.account ? getAccountBalanceCents(candidate.account) : null;
                return (
                  <tr key={candidate.id}>
                    <td className="px-4 py-3 text-neutral-bg">{candidate.businessName}</td>
                    <td className="px-4 py-3 text-neutral-bg/70" dir="ltr">
                      {candidate.contactPhone ?? candidate.user?.phone ?? "—"}
                    </td>
                    <td className="px-4 py-3 text-neutral-bg/70">{candidate.assignedRep?.user.name ?? "—"}</td>
                    <td className="px-4 py-3">
                      <Badge variant={getMerchantStatusBadgeVariant(candidate.status)}>{getMerchantStatusLabel(candidate.status)}</Badge>
                    </td>
                    <td className="px-4 py-3 text-neutral-bg/70" dir="ltr">
                      {balanceCents !== null ? formatCurrencyFromCents(balanceCents) : "لا يوجد حساب"}
                    </td>
                    <td className="px-4 py-3 text-end">
                      <Link href={`/admin/merchants/${targetMerchantId}/merge?sourceId=${candidate.id}`}>
                        <Button type="button" size="sm" variant="outline">
                          اختيار
                        </Button>
                      </Link>
                    </td>
                  </tr>
                );
              })}
              {candidates.length === 0 && <AdminEmptyRow colSpan={6} message="لا توجد نتائج مطابقة" />}
            </AdminTableBody>
          </AdminTable>
        </CardContent>
      </Card>
    </div>
  );
}

function MergePartyCard({
  title,
  name,
  status,
  figures,
}: {
  title: string;
  name: string;
  status: string;
  figures: { balanceCents: number; orderCount: number; paymentCount: number; salesTotalCents: number; paymentTotalCents: number };
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        <Badge variant={getMerchantStatusBadgeVariant(status)}>{getMerchantStatusLabel(status)}</Badge>
      </CardHeader>
      <CardContent className="flex flex-col gap-2 text-sm">
        <Row label="اسم المحل" value={name} />
        <Row label="الرصيد الحالي" value={formatCurrencyFromCents(figures.balanceCents)} />
        <Row label="عدد الفواتير" value={String(figures.orderCount)} />
        <Row label="إجمالي المبيعات" value={formatCurrencyFromCents(figures.salesTotalCents)} />
        <Row label="عدد الدفعات" value={String(figures.paymentCount)} />
        <Row label="إجمالي الدفعات" value={formatCurrencyFromCents(figures.paymentTotalCents)} />
      </CardContent>
    </Card>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-neutral-bg/60">{label}</span>
      <span className="font-medium text-neutral-bg" dir="ltr">
        {value}
      </span>
    </div>
  );
}

function MiniStat({ label, value, emphasize }: { label: string; value: string; emphasize?: boolean }) {
  return (
    <div className="rounded-card border border-navy-soft bg-navy-surface p-4">
      <p className="text-xs text-neutral-bg/60">{label}</p>
      <p className={emphasize ? "mt-1 text-xl font-bold text-gold-dark" : "mt-1 text-lg font-semibold text-neutral-bg"} dir="ltr">
        {value}
      </p>
    </div>
  );
}
