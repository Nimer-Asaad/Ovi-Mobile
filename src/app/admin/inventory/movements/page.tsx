import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { Input } from "@/components/ui/Input";
import { Select } from "@/components/ui/Select";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { AdminTable, AdminTableHead, AdminTableBody, AdminEmptyRow } from "@/components/admin/AdminTable";
import { MANUAL_STOCK_MOVEMENT_TYPES } from "@/lib/constants";
import { getMovementTypeLabel, getMovementTypeBadgeVariant } from "@/lib/inventory-labels";

interface AdminInventoryMovementsPageProps {
  searchParams: Promise<{
    q?: string;
    type?: string;
    from?: string;
    to?: string;
    productId?: string;
  }>;
}

export default async function AdminInventoryMovementsPage({ searchParams }: AdminInventoryMovementsPageProps) {
  const { q, type, from, to, productId } = await searchParams;
  const trimmedQuery = q?.trim();

  const fromDate = from ? new Date(from) : undefined;
  const toDate = to ? new Date(to) : undefined;
  if (toDate) toDate.setHours(23, 59, 59, 999);

  const movements = await prisma.stockMovement.findMany({
    where: {
      ...(productId ? { productId } : {}),
      ...(type ? { type } : {}),
      ...(fromDate || toDate
        ? { createdAt: { ...(fromDate ? { gte: fromDate } : {}), ...(toDate ? { lte: toDate } : {}) } }
        : {}),
      ...(trimmedQuery
        ? {
            product: {
              OR: [{ name: { contains: trimmedQuery } }, { sku: { contains: trimmedQuery } }],
            },
          }
        : {}),
    },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      type: true,
      quantity: true,
      previousQuantity: true,
      newQuantity: true,
      note: true,
      createdAt: true,
      product: { select: { sku: true, name: true, nameAr: true } },
      fromLocation: { select: { name: true } },
      toLocation: { select: { name: true } },
      createdBy: { select: { name: true, email: true } },
    },
  });

  const filteredProductLabel = productId
    ? (await prisma.product.findUnique({ where: { id: productId }, select: { name: true, sku: true } })) ?? null
    : null;

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h2 className="text-xl font-semibold text-neutral-bg">سجل حركات المخزون</h2>
        <p className="mt-1 text-sm text-neutral-bg/60">
          {filteredProductLabel
            ? `سجل الحركات الخاص بـ ${filteredProductLabel.name} (${filteredProductLabel.sku})`
            : "سجل تدقيق كامل لكل حركات المخزون — للقراءة فقط"}
        </p>
      </div>

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
        </AdminTableHead>
        <AdminTableBody>
          {movements.map((movement) => (
            <tr key={movement.id}>
              <td className="px-4 py-3 text-neutral-bg/70">
                {new Date(movement.createdAt).toLocaleString("ar")}
              </td>
              <td className="px-4 py-3 text-neutral-bg">{movement.product.nameAr ?? movement.product.name}</td>
              <td className="px-4 py-3 text-neutral-bg/70">{movement.product.sku}</td>
              <td className="px-4 py-3">
                <Badge variant={getMovementTypeBadgeVariant(movement.type)}>
                  {getMovementTypeLabel(movement.type)}
                </Badge>
              </td>
              <td className="px-4 py-3 text-neutral-bg/70">{movement.quantity}</td>
              <td className="px-4 py-3 text-neutral-bg/70">{movement.previousQuantity ?? "—"}</td>
              <td className="px-4 py-3 text-neutral-bg/70">{movement.newQuantity ?? "—"}</td>
              <td className="px-4 py-3 text-neutral-bg/70">
                {movement.toLocation?.name ?? movement.fromLocation?.name ?? "—"}
              </td>
              <td className="px-4 py-3 text-neutral-bg/70">{movement.createdBy?.name ?? "—"}</td>
              <td className="px-4 py-3 text-neutral-bg/70">{movement.note ?? "—"}</td>
            </tr>
          ))}
          {movements.length === 0 && <AdminEmptyRow colSpan={10} message="لا توجد حركات مخزون مطابقة" />}
        </AdminTableBody>
      </AdminTable>
    </div>
  );
}
