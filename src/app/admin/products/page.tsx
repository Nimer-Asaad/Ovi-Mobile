import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { AdminTable, AdminTableHead, AdminTableBody, AdminEmptyRow } from "@/components/admin/AdminTable";
import { AdminStatusBadge } from "@/components/admin/AdminStatusBadge";
import { ActiveToggleForm } from "@/components/admin/ActiveToggleForm";
import { ProductImagePlaceholder } from "@/components/catalog/ProductImagePlaceholder";
import { formatCurrencyFromCents } from "@/lib/utils";
import { toggleProductActive } from "./actions";

export default async function AdminProductsPage() {
  const products = await prisma.product.findMany({
    orderBy: { createdAt: "desc" },
    include: {
      category: true,
      brand: true,
      // Main Warehouse stock only — rep-assigned stock is tracked separately under /admin/reps.
      inventoryItems: { where: { location: { isDefault: true } }, select: { quantity: true } },
      images: {
        select: { url: true, altText: true },
        orderBy: [{ isMain: "desc" }, { sortOrder: "asc" }],
        take: 1,
      },
    },
  });

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-semibold text-neutral-bg">المنتجات</h2>
          <p className="mt-1 text-sm text-neutral-bg/60">إدارة كتالوج المنتجات</p>
        </div>
        <Link href="/admin/products/new">
          <Button>إضافة منتج</Button>
        </Link>
      </div>

      <AdminTable>
        <AdminTableHead>
          <th className="px-4 py-3 text-start"></th>
          <th className="px-4 py-3 text-start">SKU</th>
          <th className="px-4 py-3 text-start">الاسم</th>
          <th className="px-4 py-3 text-start">القسم</th>
          <th className="px-4 py-3 text-start">العلامة</th>
          <th className="px-4 py-3 text-start">سعر التجزئة</th>
          <th className="px-4 py-3 text-start">سعر الجملة</th>
          <th className="px-4 py-3 text-start">المخزون</th>
          <th className="px-4 py-3 text-start">الحالة</th>
          <th className="px-4 py-3 text-start"></th>
        </AdminTableHead>
        <AdminTableBody>
          {products.map((product) => {
            const stock = product.inventoryItems.reduce((sum, item) => sum + item.quantity, 0);
            const thumbnail = product.images[0];
            return (
              <tr key={product.id}>
                <td className="px-4 py-3">
                  <div className="h-12 w-12 overflow-hidden rounded-card">
                    {thumbnail ? (
                      // eslint-disable-next-line @next/next/no-img-element -- arbitrary admin-entered external URLs
                      <img
                        src={thumbnail.url}
                        alt={thumbnail.altText ?? product.name}
                        className="h-full w-full object-cover"
                      />
                    ) : (
                      <ProductImagePlaceholder className="h-full w-full" />
                    )}
                  </div>
                </td>
                <td className="px-4 py-3 text-neutral-bg/70">{product.sku}</td>
                <td className="px-4 py-3 text-neutral-bg">
                  {product.name}
                  {product.isFeatured && (
                    <Badge variant="gold" className="ms-2">
                      مميز
                    </Badge>
                  )}
                </td>
                <td className="px-4 py-3 text-neutral-bg/70">
                  {product.category?.nameAr ?? product.category?.name ?? "—"}
                </td>
                <td className="px-4 py-3 text-neutral-bg/70">{product.brand?.name ?? "—"}</td>
                <td className="px-4 py-3 text-neutral-bg/70">
                  {formatCurrencyFromCents(product.retailPriceCents)}
                </td>
                <td className="px-4 py-3 text-neutral-bg/70">
                  {formatCurrencyFromCents(product.wholesalePriceCents)}
                </td>
                <td className="px-4 py-3 text-neutral-bg/70">{stock}</td>
                <td className="px-4 py-3">
                  <AdminStatusBadge isActive={product.isActive} />
                </td>
                <td className="px-4 py-3">
                  <div className="flex items-center justify-end gap-3">
                    <Link
                      href={`/admin/products/${product.id}/edit`}
                      className="text-sm text-gold-champagne hover:underline"
                    >
                      تعديل
                    </Link>
                    <ActiveToggleForm
                      isActive={product.isActive}
                      action={toggleProductActive.bind(null, product.id)}
                    />
                  </div>
                </td>
              </tr>
            );
          })}
          {products.length === 0 && <AdminEmptyRow colSpan={10} message="لا توجد منتجات حتى الآن" />}
        </AdminTableBody>
      </AdminTable>
    </div>
  );
}
