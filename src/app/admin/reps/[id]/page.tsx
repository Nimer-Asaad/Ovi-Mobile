import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { AdminStatusBadge } from "@/components/admin/AdminStatusBadge";
import { AdminTable, AdminTableHead, AdminTableBody, AdminEmptyRow } from "@/components/admin/AdminTable";
import { ProductImagePlaceholder } from "@/components/catalog/ProductImagePlaceholder";
import { getMovementTypeLabel, getMovementTypeBadgeVariant } from "@/lib/inventory-labels";

interface AdminRepDetailPageProps {
  params: Promise<{ id: string }>;
}

export default async function AdminRepDetailPage({ params }: AdminRepDetailPageProps) {
  const { id } = await params;

  const rep = await prisma.salesRepresentative.findUnique({
    where: { id },
    select: {
      id: true,
      employeeCode: true,
      isActive: true,
      user: { select: { name: true, email: true, phone: true, isActive: true } },
      carStockLocation: { select: { id: true, name: true } },
    },
  });

  if (!rep) {
    notFound();
  }

  const locationId = rep.carStockLocation?.id ?? null;

  const [stockItems, movements] = await Promise.all([
    locationId
      ? prisma.inventoryItem.findMany({
          where: { locationId, quantity: { gt: 0 } },
          orderBy: { updatedAt: "desc" },
          select: {
            quantity: true,
            product: {
              select: {
                sku: true,
                name: true,
                nameAr: true,
                category: { select: { name: true, nameAr: true } },
                brand: { select: { name: true } },
                images: {
                  select: { url: true, altText: true },
                  orderBy: [{ isMain: "desc" }, { sortOrder: "asc" }],
                  take: 1,
                },
              },
            },
          },
        })
      : Promise.resolve([]),
    locationId
      ? prisma.stockMovement.findMany({
          where: { OR: [{ fromLocationId: locationId }, { toLocationId: locationId }] },
          orderBy: { createdAt: "desc" },
          take: 20,
          select: {
            id: true,
            type: true,
            quantity: true,
            previousQuantity: true,
            newQuantity: true,
            note: true,
            createdAt: true,
            product: { select: { sku: true, name: true, nameAr: true } },
          },
        })
      : Promise.resolve([]),
  ]);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-xl font-semibold text-neutral-bg">{rep.user.name}</h2>
          <p className="mt-1 text-sm text-neutral-bg/60">{rep.employeeCode}</p>
        </div>
        <div className="flex items-center gap-2">
          <AdminStatusBadge isActive={rep.isActive && rep.user.isActive} />
          <Link href={`/admin/reps/${rep.id}/assign-stock`}>
            <Button>تخصيص مخزون</Button>
          </Link>
          <Link href={`/admin/reps/${rep.id}/return-stock`}>
            <Button variant="outline">إرجاع مخزون</Button>
          </Link>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>معلومات المندوب</CardTitle>
        </CardHeader>
        <CardContent>
          <dl className="grid grid-cols-1 gap-2 text-sm sm:grid-cols-2">
            <div>
              <dt className="text-neutral-bg/50">البريد الإلكتروني</dt>
              <dd className="text-neutral-bg">{rep.user.email}</dd>
            </div>
            <div>
              <dt className="text-neutral-bg/50">الهاتف</dt>
              <dd className="text-neutral-bg">{rep.user.phone ?? "—"}</dd>
            </div>
            <div>
              <dt className="text-neutral-bg/50">موقع المخزون</dt>
              <dd className="text-neutral-bg">{rep.carStockLocation?.name ?? "لم يُخصص بعد"}</dd>
            </div>
          </dl>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>المخزون الحالي</CardTitle>
        </CardHeader>
        <CardContent>
          <AdminTable>
            <AdminTableHead>
              <th className="px-4 py-3 text-start"></th>
              <th className="px-4 py-3 text-start">الاسم</th>
              <th className="px-4 py-3 text-start">SKU</th>
              <th className="px-4 py-3 text-start">القسم</th>
              <th className="px-4 py-3 text-start">العلامة</th>
              <th className="px-4 py-3 text-start">الكمية</th>
            </AdminTableHead>
            <AdminTableBody>
              {stockItems.map((item) => {
                const thumbnail = item.product.images[0];
                return (
                  <tr key={item.product.sku}>
                    <td className="px-4 py-3">
                      <div className="h-10 w-10 overflow-hidden rounded-card">
                        {thumbnail ? (
                          // eslint-disable-next-line @next/next/no-img-element -- arbitrary admin-entered external URLs
                          <img
                            src={thumbnail.url}
                            alt={thumbnail.altText ?? item.product.name}
                            className="h-full w-full object-cover"
                          />
                        ) : (
                          <ProductImagePlaceholder className="h-full w-full" />
                        )}
                      </div>
                    </td>
                    <td className="px-4 py-3 text-neutral-bg">{item.product.nameAr ?? item.product.name}</td>
                    <td className="px-4 py-3 text-neutral-bg/70">{item.product.sku}</td>
                    <td className="px-4 py-3 text-neutral-bg/70">
                      {item.product.category?.nameAr ?? item.product.category?.name ?? "—"}
                    </td>
                    <td className="px-4 py-3 text-neutral-bg/70">{item.product.brand?.name ?? "—"}</td>
                    <td className="px-4 py-3 text-neutral-bg">{item.quantity}</td>
                  </tr>
                );
              })}
              {stockItems.length === 0 && <AdminEmptyRow colSpan={6} message="لا يوجد مخزون مخصص لهذا المندوب" />}
            </AdminTableBody>
          </AdminTable>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>آخر حركات المخزون</CardTitle>
        </CardHeader>
        <CardContent>
          <AdminTable>
            <AdminTableHead>
              <th className="px-4 py-3 text-start">التاريخ</th>
              <th className="px-4 py-3 text-start">المنتج</th>
              <th className="px-4 py-3 text-start">النوع</th>
              <th className="px-4 py-3 text-start">الكمية</th>
              <th className="px-4 py-3 text-start">السابق</th>
              <th className="px-4 py-3 text-start">الجديد</th>
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
                  <td className="px-4 py-3 text-neutral-bg/70">{movement.previousQuantity ?? "—"}</td>
                  <td className="px-4 py-3 text-neutral-bg/70">{movement.newQuantity ?? "—"}</td>
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
