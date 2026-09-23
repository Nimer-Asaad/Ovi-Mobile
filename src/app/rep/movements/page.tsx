import { requireEffectiveRepresentative } from "@/lib/auth/impersonation";
import { prisma } from "@/lib/prisma";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { LinkButton } from "@/components/ui/LinkButton";
import { PageHeader } from "@/components/ui/PageHeader";
import { AdminTable, AdminTableHead, AdminTableBody, AdminEmptyRow } from "@/components/admin/AdminTable";
import { getMovementTypeLabel, getMovementTypeBadgeVariant } from "@/lib/inventory-labels";

interface RepMovementsPageProps {
  searchParams: Promise<{ page?: string }>;
}

// StockMovement is an append-only audit ledger (see its doc comment in
// schema.prisma) — it only ever grows, company-wide, and has no index on
// fromLocationId/toLocationId/createdAt. An unbounded findMany here (no
// take/skip at all) was the actual cause of this page hanging indefinitely
// in production: every visit forced Postgres to scan and sort the ENTIRE
// table before returning anything. Bounded, database-level pagination (same
// fix already applied to the admin equivalent — see
// src/app/admin/inventory/movements/page.tsx's own doc comment for the
// identical pre-fix symptom) caps both the DB-side work and what Node has to
// serialize, without hiding or deleting any history — every older movement
// stays reachable via "السابق".
const PAGE_SIZE = 50;

// Accepts ONLY a bare positive integer — no leading zero, no sign, no
// decimal point, no trailing characters, no whitespace — and rejects any
// value outside Number.isSafeInteger's range. Number.parseInt alone would
// silently truncate "2.5"/"2abc" into a plausible-looking (but wrong) page
// 2, and would let an absurdly long digit string reach Prisma as an
// unbounded float; everything that doesn't match is normalized to page 1
// instead.
function parsePageParam(raw: string | undefined): number {
  if (raw && /^[1-9]\d*$/.test(raw) && Number.isSafeInteger(Number(raw))) {
    return Number(raw);
  }
  return 1;
}

export default async function RepMovementsPage({ searchParams }: RepMovementsPageProps) {
  const effectiveRep = await requireEffectiveRepresentative();
  const locationId = effectiveRep.carStockLocationId;
  const { page: pageParam } = await searchParams;
  const requestedPage = parsePageParam(pageParam);

  const where = locationId ? { OR: [{ fromLocationId: locationId }, { toLocationId: locationId }] } : null;

  // count first — its result decides the real last page. A stale/typed
  // ?page=999999 must never reach Prisma as a beyond-range skip (which
  // would silently return zero rows while the label still claimed to be on
  // page 999999): clamping against the real totalPages below keeps the
  // displayed page, the Previous/Next links, and the actually-rendered rows
  // always consistent, for every input.
  const totalCount = where ? await prisma.stockMovement.count({ where }) : 0;
  const totalPages = Math.max(1, Math.ceil(totalCount / PAGE_SIZE));
  const page = Math.min(requestedPage, totalPages);

  const movements = where
    ? await prisma.stockMovement.findMany({
        where,
        // createdAt alone is not unique (bulk operations can share the same
        // millisecond) — id is added as a deterministic tiebreaker so a
        // row can never be silently skipped or duplicated across pages.
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        skip: (page - 1) * PAGE_SIZE,
        take: PAGE_SIZE,
        select: {
          id: true,
          type: true,
          quantity: true,
          note: true,
          createdAt: true,
          product: { select: { sku: true, name: true, nameAr: true } },
          variant: { select: { phoneModel: { select: { name: true, nameAr: true, phoneBrand: { select: { name: true, nameAr: true } } } } } },
          deviceColorVariant: { select: { phoneModel: { select: { name: true, nameAr: true, phoneBrand: { select: { name: true, nameAr: true } } } }, color: { select: { name: true, nameAr: true } } } },
          fromLocation: { select: { name: true } },
          toLocation: { select: { name: true } },
        },
      })
    : [];

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-6">
      <PageHeader
        title="سجل حركات مخزوني"
        subtitle={`جميع الحركات المتعلقة بمخزونك — للقراءة فقط — ${totalCount} حركة`}
      />

      <Card>
        <CardHeader>
          <CardTitle>الحركات</CardTitle>
        </CardHeader>
        <CardContent>
          <AdminTable>
            <AdminTableHead>
              <th className="px-4 py-3 text-start">التاريخ</th>
              <th className="px-4 py-3 text-start">المنتج</th>
              <th className="px-4 py-3 text-start">النوع</th>
              <th className="px-4 py-3 text-start">الكمية</th>
              <th className="px-4 py-3 text-start">من</th>
              <th className="px-4 py-3 text-start">إلى</th>
              <th className="px-4 py-3 text-start">ملاحظات</th>
            </AdminTableHead>
            <AdminTableBody>
              {movements.map((movement) => (
                <tr key={movement.id}>
                  <td className="px-4 py-3 text-neutral-bg/70">
                    {new Date(movement.createdAt).toLocaleString("ar")}
                  </td>
                  <td className="px-4 py-3 text-neutral-bg">
                    {movement.product.nameAr ?? movement.product.name}
                    <span className="ms-2 text-xs text-neutral-bg/50">{movement.product.sku}</span>
                    {movement.variant && <span className="block text-xs text-gold-champagne">{movement.variant.phoneModel.phoneBrand.nameAr ?? movement.variant.phoneModel.phoneBrand.name} / {movement.variant.phoneModel.nameAr ?? movement.variant.phoneModel.name}</span>}
                    {movement.deviceColorVariant && <span className="block text-xs text-gold-champagne">{movement.deviceColorVariant.phoneModel.phoneBrand.nameAr ?? movement.deviceColorVariant.phoneModel.phoneBrand.name} / {movement.deviceColorVariant.phoneModel.nameAr ?? movement.deviceColorVariant.phoneModel.name} / {movement.deviceColorVariant.color.nameAr ?? movement.deviceColorVariant.color.name}</span>}
                  </td>
                  <td className="px-4 py-3">
                    <Badge variant={getMovementTypeBadgeVariant(movement.type)}>
                      {getMovementTypeLabel(movement.type)}
                    </Badge>
                  </td>
                  <td className="px-4 py-3 text-neutral-bg/70">{movement.quantity}</td>
                  <td className="px-4 py-3 text-neutral-bg/70">{movement.fromLocation?.name ?? "—"}</td>
                  <td className="px-4 py-3 text-neutral-bg/70">{movement.toLocation?.name ?? "—"}</td>
                  <td className="px-4 py-3 text-neutral-bg/70">{movement.note ?? "—"}</td>
                </tr>
              ))}
              {movements.length === 0 && <AdminEmptyRow colSpan={7} message="لا توجد حركات مخزون بعد" />}
            </AdminTableBody>
          </AdminTable>
        </CardContent>
      </Card>

      {totalPages > 1 && (
        <div className="flex flex-wrap items-center justify-between gap-4 text-sm text-neutral-bg/70">
          <span>
            صفحة {page} من {totalPages}
          </span>
          <div className="flex gap-2">
            {page > 1 && (
              <LinkButton href={`/rep/movements?page=${page - 1}`} variant="outline" size="sm">
                السابق
              </LinkButton>
            )}
            {page < totalPages && (
              <LinkButton href={`/rep/movements?page=${page + 1}`} variant="outline" size="sm">
                التالي
              </LinkButton>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
