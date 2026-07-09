import { requireRole } from "@/lib/auth/guards";
import { ROLES } from "@/lib/constants";
import { prisma } from "@/lib/prisma";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { AdminTable, AdminTableHead, AdminTableBody, AdminEmptyRow } from "@/components/admin/AdminTable";
import { LogoutButton } from "@/components/auth/LogoutButton";
import { getMovementTypeLabel, getMovementTypeBadgeVariant } from "@/lib/inventory-labels";

export default async function RepMovementsPage() {
  const user = await requireRole([ROLES.SALES_REPRESENTATIVE]);

  const rep = await prisma.salesRepresentative.findUnique({
    where: { userId: user.id },
    select: { carStockLocation: { select: { id: true } } },
  });

  const locationId = rep?.carStockLocation?.id ?? null;

  const movements = locationId
    ? await prisma.stockMovement.findMany({
        where: { OR: [{ fromLocationId: locationId }, { toLocationId: locationId }] },
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
        },
      })
    : [];

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-6 px-4 py-10">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-neutral-bg">سجل حركات مخزوني</h1>
          <p className="mt-1 text-sm text-neutral-bg/60">جميع الحركات المتعلقة بمخزونك — للقراءة فقط</p>
        </div>
        <LogoutButton />
      </div>

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
    </div>
  );
}
