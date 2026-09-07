import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { Input } from "@/components/ui/Input";
import { Select } from "@/components/ui/Select";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { PageHeader } from "@/components/ui/PageHeader";
import { AdminTable, AdminTableHead, AdminTableBody, AdminEmptyRow } from "@/components/admin/AdminTable";
import { MANUAL_STOCK_MOVEMENT_TYPES, ROLES } from "@/lib/constants";
import { getMovementTypeLabel, getMovementTypeBadgeVariant } from "@/lib/inventory-labels";
import { requireRole } from "@/lib/auth/guards";
import { CorrectionDialog } from "@/components/shared/CorrectionDialog";
import { cancelManualInventoryBatchAction } from "@/app/admin/inventory/actions";

interface AdminInventoryMovementsPageProps {
  searchParams: Promise<{
    q?: string;
    type?: string;
    from?: string;
    to?: string;
    productId?: string;
    page?: string;
    pageSize?: string;
  }>;
}

const PAGE_SIZE_OPTIONS = [25, 50, 100] as const;
const DEFAULT_PAGE_SIZE = 50;

// ADMIN and ADMIN_ASSISTANT both eligible — including the "إلغاء العملية"
// correction control added alongside the sales/payments correction feature
// (explicitly approved): the same two roles already allowed to CREATE a
// manual STOCK_IN/STOCK_OUT batch here (see /admin/inventory/receive,
// /admin/inventory/issue) are also allowed to cancel/reverse one, via
// cancelManualInventoryBatchAction's own requireRole. This explicit guard
// is otherwise redundant with the outer /admin layout's own ADMIN |
// ADMIN_ASSISTANT gate; it exists so this page's access boundary is
// visible on its own, matching every other ADMIN_ASSISTANT-reachable page
// under /admin/orders and /admin/inventory.
export default async function AdminInventoryMovementsPage({ searchParams }: AdminInventoryMovementsPageProps) {
  await requireRole([ROLES.ADMIN, ROLES.ADMIN_ASSISTANT]);

  const params = await searchParams;
  const { q, type, from, to, productId } = params;
  const trimmedQuery = q?.trim();
  const page = Math.max(1, Number.parseInt(params.page ?? "1", 10) || 1);
  const pageSize = PAGE_SIZE_OPTIONS.includes(Number(params.pageSize) as (typeof PAGE_SIZE_OPTIONS)[number])
    ? Number(params.pageSize)
    : DEFAULT_PAGE_SIZE;

  const fromDate = from ? new Date(from) : undefined;
  const toDate = to ? new Date(to) : undefined;
  if (toDate) toDate.setHours(23, 59, 59, 999);

  const where = {
    ...(productId ? { productId } : {}),
    ...(type ? { type } : {}),
    ...(fromDate || toDate
      ? { createdAt: { ...(fromDate ? { gte: fromDate } : {}), ...(toDate ? { lte: toDate } : {}) } }
      : {}),
    ...(trimmedQuery
      ? {
          product: {
            OR: [
              { name: { contains: trimmedQuery, mode: "insensitive" as const } },
              { sku: { contains: trimmedQuery, mode: "insensitive" as const } },
            ],
          },
        }
      : {}),
  };

  // count + the current page's rows only, in parallel — never the full
  // history. StockMovement is an append-only audit ledger (see its doc
  // comment in schema.prisma) that only grows, so an unbounded findMany here
  // was the actual bottleneck this page used to have: every visit re-scanned
  // and serialized the entire filtered history regardless of how much of it
  // was ever shown.
  const [totalCount, movements, filteredProductLabel] = await Promise.all([
    prisma.stockMovement.count({ where }),
    prisma.stockMovement.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * pageSize,
      take: pageSize,
      select: {
        id: true,
        type: true,
        quantity: true,
        previousQuantity: true,
        newQuantity: true,
        note: true,
        createdAt: true,
        product: { select: { sku: true, name: true, nameAr: true } },
        variant: { select: { phoneModel: { select: { name: true, nameAr: true, phoneBrand: { select: { name: true, nameAr: true } } } } } },
        deviceColorVariant: { select: { phoneModel: { select: { name: true, nameAr: true, phoneBrand: { select: { name: true, nameAr: true } } } }, color: { select: { name: true, nameAr: true } } } },
        fromLocation: { select: { name: true } },
        toLocation: { select: { name: true } },
        createdBy: { select: { name: true } },
        manualBatchId: true,
        manualBatch: {
          select: {
            id: true,
            reversalOfId: true,
            correctionReason: true,
            reversedBy: { select: { id: true, correctionReason: true } },
          },
        },
      },
    }),
    productId ? prisma.product.findUnique({ where: { id: productId }, select: { name: true, sku: true } }) : Promise.resolve(null),
  ]);

  // Which StockMovement row is the ONE "canonical" line for a given batch —
  // determined query-side (MIN(id), grouped over the batch's FULL movement
  // set, not just this page's rows), so it stays correct no matter which
  // page a batch's lines happen to land on. A page-local "first row seen"
  // Set would only guarantee one button PER PAGE — if a batch's lines
  // spanned two pages, both pages could independently show a button. This
  // query is bounded to exactly the distinct batch ids present on this
  // page (never unbounded), and MIN(id) is a deterministic function of the
  // batch's row set, not a fragile timestamp heuristic. Server-side
  // rejection (cancelManualInventoryBatch itself) remains the real safety
  // net regardless — this only tightens the UX so it never even suggests
  // more than one control per logical operation.
  const distinctBatchIds = [...new Set(movements.map((m) => m.manualBatchId).filter((id): id is string => Boolean(id)))];
  const canonicalMovementIdByBatch = new Map<string, string>();
  if (distinctBatchIds.length > 0) {
    const canonicalRows = await prisma.stockMovement.groupBy({
      by: ["manualBatchId"],
      where: { manualBatchId: { in: distinctBatchIds } },
      _min: { id: true },
    });
    for (const row of canonicalRows) {
      if (row.manualBatchId && row._min.id) canonicalMovementIdByBatch.set(row.manualBatchId, row._min.id);
    }
  }

  const totalPages = Math.max(1, Math.ceil(totalCount / pageSize));

  function buildUrl(overrides: Record<string, string | undefined>): string {
    const next = new URLSearchParams();
    const current = { ...params, ...overrides };
    for (const [key, value] of Object.entries(current)) {
      if (value) next.set(key, value);
    }
    const qs = next.toString();
    return qs ? `/admin/inventory/movements?${qs}` : "/admin/inventory/movements";
  }

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="سجل حركات المخزون"
        subtitle={
          filteredProductLabel
            ? `سجل الحركات الخاص بـ ${filteredProductLabel.name} (${filteredProductLabel.sku}) — ${totalCount} حركة`
            : `سجل تدقيق كامل لكل حركات المخزون — للقراءة فقط — ${totalCount} حركة`
        }
      />

      <form
        method="GET"
        className="grid grid-cols-1 gap-4 rounded-card border border-navy-soft bg-navy-surface p-4 sm:grid-cols-2 lg:grid-cols-5"
      >
        {productId && <input type="hidden" name="productId" value={productId} />}

        <div className="lg:col-span-2">
          <Input name="q" label="بحث بالاسم أو رمز المنتج" defaultValue={trimmedQuery ?? ""} />
        </div>

        <Select name="type" label="نوع الحركة" defaultValue={type ?? ""}>
          <option value="">كل الأنواع</option>
          {Object.values(MANUAL_STOCK_MOVEMENT_TYPES).map((value) => (
            <option key={value} value={value}>
              {getMovementTypeLabel(value)}
            </option>
          ))}
        </Select>

        <Input name="from" type="date" label="من تاريخ" defaultValue={from ?? ""} />
        <Input name="to" type="date" label="إلى تاريخ" defaultValue={to ?? ""} />

        <Select name="pageSize" label="عدد الصفوف" defaultValue={String(pageSize)}>
          {PAGE_SIZE_OPTIONS.map((size) => (
            <option key={size} value={size}>
              {size}
            </option>
          ))}
        </Select>

        <div className="flex items-end gap-2 lg:col-span-5">
          <Button type="submit">تصفية</Button>
          {productId && (
            <Link href="/admin/inventory/movements">
              <Button type="button" variant="outline">
                إزالة تصفية المنتج
              </Button>
            </Link>
          )}
        </div>
      </form>

      <AdminTable>
        <AdminTableHead>
          <th className="px-4 py-3 text-start">التاريخ</th>
          <th className="px-4 py-3 text-start">المنتج</th>
          <th className="px-4 py-3 text-start">SKU</th>
          <th className="px-4 py-3 text-start">النوع</th>
          <th className="px-4 py-3 text-start">الكمية</th>
          <th className="px-4 py-3 text-start">السابق</th>
          <th className="px-4 py-3 text-start">الجديد</th>
          <th className="px-4 py-3 text-start">الموقع</th>
          <th className="px-4 py-3 text-start">بواسطة</th>
          <th className="px-4 py-3 text-start">ملاحظات</th>
          <th className="px-4 py-3 text-start">رقم العملية</th>
          <th className="px-4 py-3 text-start"></th>
        </AdminTableHead>
        <AdminTableBody>
          {/* One bulk receive/issue submission shares one ManualInventoryBatch
             — only the batch's own canonical movement row (MIN(id) across
             the batch's FULL row set, computed query-side above, correct
             regardless of pagination) shows the "إلغاء العملية" control
             (clicking it cancels the WHOLE batch, every line, atomically —
             never just that one line). Every other line of the same batch
             instead shows "ضمن نفس العملية" against the same batch
             reference, so it's visually obvious they are one logical
             operation, never N independently-cancellable ones. */}
          {movements.map((movement) => {
            const isReversalLine = Boolean(movement.manualBatch?.reversalOfId);
            const isReversed = Boolean(movement.manualBatch?.reversedBy);
            const isEligibleManualBatch =
              (movement.type === MANUAL_STOCK_MOVEMENT_TYPES.STOCK_IN || movement.type === MANUAL_STOCK_MOVEMENT_TYPES.STOCK_OUT) &&
              movement.manualBatch &&
              !isReversalLine;
            const batchId = movement.manualBatch?.id ?? null;
            const isCanonicalRowOfBatch = batchId ? canonicalMovementIdByBatch.get(batchId) === movement.id : false;
            const showCancelControl = isEligibleManualBatch && !isReversed && isCanonicalRowOfBatch;

            return (
              <tr key={movement.id}>
                <td className="px-4 py-3 text-neutral-bg/70">
                  {new Date(movement.createdAt).toLocaleString("ar")}
                </td>
                <td className="px-4 py-3 text-neutral-bg">
                  {movement.product.nameAr ?? movement.product.name}
                  {movement.variant && <span className="block text-xs text-gold-champagne">{movement.variant.phoneModel.phoneBrand.nameAr ?? movement.variant.phoneModel.phoneBrand.name} / {movement.variant.phoneModel.nameAr ?? movement.variant.phoneModel.name}</span>}
                  {movement.deviceColorVariant && <span className="block text-xs text-gold-champagne">{movement.deviceColorVariant.phoneModel.phoneBrand.nameAr ?? movement.deviceColorVariant.phoneModel.phoneBrand.name} / {movement.deviceColorVariant.phoneModel.nameAr ?? movement.deviceColorVariant.phoneModel.name} / {movement.deviceColorVariant.color.nameAr ?? movement.deviceColorVariant.color.name}</span>}
                </td>
                <td className="px-4 py-3 text-neutral-bg/70">{movement.product.sku}</td>
                <td className="px-4 py-3">
                  <Badge variant={getMovementTypeBadgeVariant(movement.type)}>
                    {getMovementTypeLabel(movement.type)}
                  </Badge>
                  {isReversalLine && <Badge variant="neutral" className="ms-1">عكس عملية</Badge>}
                  {isReversed && <Badge variant="danger" className="ms-1">ملغاة</Badge>}
                </td>
                <td className="px-4 py-3 text-neutral-bg/70">{movement.quantity}</td>
                <td className="px-4 py-3 text-neutral-bg/70">{movement.previousQuantity ?? "—"}</td>
                <td className="px-4 py-3 text-neutral-bg/70">{movement.newQuantity ?? "—"}</td>
                <td className="px-4 py-3 text-neutral-bg/70">
                  {movement.toLocation?.name ?? movement.fromLocation?.name ?? "—"}
                </td>
                <td className="px-4 py-3 text-neutral-bg/70">{movement.createdBy?.name ?? "—"}</td>
                <td className="px-4 py-3 text-neutral-bg/70">{movement.note ?? "—"}</td>
                <td className="px-4 py-3 font-mono text-xs text-neutral-bg/50" dir="ltr">
                  {batchId ? `#${batchId.slice(-8)}` : "—"}
                  {batchId && !isCanonicalRowOfBatch && <span className="mt-0.5 block text-neutral-bg/40">ضمن نفس العملية</span>}
                </td>
                <td className="px-4 py-3">
                  {showCancelControl && (
                    <CorrectionDialog
                      action={cancelManualInventoryBatchAction}
                      hiddenFields={{ batchId: movement.manualBatch!.id }}
                      triggerLabel="إلغاء العملية"
                      title="إلغاء عملية المخزون"
                      description="سيتم عكس هذه العملية بالكامل (كل الأصناف المرتبطة بها) عبر عملية جديدة بأثر معاكس، دون حذف السجل الأصلي."
                      confirmLabel="تأكيد الإلغاء"
                      replacementHref={
                        movement.type === MANUAL_STOCK_MOVEMENT_TYPES.STOCK_OUT ? "/admin/inventory/issue" : "/admin/inventory/receive"
                      }
                      replacementLabel="إدخال عملية صحيحة"
                    />
                  )}
                  {isReversed && movement.manualBatch?.reversedBy?.correctionReason && (
                    <span className="text-xs text-neutral-bg/50">سبب الإلغاء: {movement.manualBatch.reversedBy.correctionReason}</span>
                  )}
                </td>
              </tr>
            );
          })}
          {movements.length === 0 && <AdminEmptyRow colSpan={12} message="لا توجد حركات مخزون مطابقة" />}
        </AdminTableBody>
      </AdminTable>

      {totalPages > 1 && (
        <div className="flex flex-wrap items-center justify-between gap-4 text-sm text-neutral-bg/70">
          <span>
            صفحة {page} من {totalPages}
          </span>
          <div className="flex gap-2">
            {page > 1 && (
              <Link href={buildUrl({ page: String(page - 1) })}>
                <Button variant="outline" size="sm" type="button">
                  السابق
                </Button>
              </Link>
            )}
            {page < totalPages && (
              <Link href={buildUrl({ page: String(page + 1) })}>
                <Button variant="outline" size="sm" type="button">
                  التالي
                </Button>
              </Link>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
