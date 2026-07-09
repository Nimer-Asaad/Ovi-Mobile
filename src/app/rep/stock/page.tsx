import { Prisma } from "@prisma/client";
import { requireRole } from "@/lib/auth/guards";
import { ROLES } from "@/lib/constants";
import { prisma } from "@/lib/prisma";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/Card";
import { AdminTable, AdminTableHead, AdminTableBody, AdminEmptyRow } from "@/components/admin/AdminTable";
import { ProductImagePlaceholder } from "@/components/catalog/ProductImagePlaceholder";
import { LogoutButton } from "@/components/auth/LogoutButton";

/** Rep-only, read-only stock select — deliberately never fetches any price
 * field (retail, wholesale, or cost). */
const REP_STOCK_ITEM_SELECT = {
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
} satisfies Prisma.InventoryItemSelect;

export default async function RepStockPage() {
  const user = await requireRole([ROLES.SALES_REPRESENTATIVE]);

  const rep = await prisma.salesRepresentative.findUnique({
    where: { userId: user.id },
    select: { carStockLocation: { select: { id: true } } },
  });

  const locationId = rep?.carStockLocation?.id ?? null;

  const items = locationId
    ? await prisma.inventoryItem.findMany({
        where: { locationId, quantity: { gt: 0 } },
        orderBy: { updatedAt: "desc" },
        select: REP_STOCK_ITEM_SELECT,
      })
    : [];

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-6 px-4 py-10">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-neutral-bg">مخزوني</h1>
          <p className="mt-1 text-sm text-neutral-bg/60">المنتجات المخصصة لك حالياً</p>
        </div>
        <LogoutButton />
      </div>

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
              {items.map((item) => {
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
              {items.length === 0 && <AdminEmptyRow colSpan={6} message="لا يوجد مخزون مخصص لك حالياً" />}
            </AdminTableBody>
          </AdminTable>
        </CardContent>
      </Card>
    </div>
  );
}
