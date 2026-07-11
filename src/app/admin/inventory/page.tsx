import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { Input } from "@/components/ui/Input";
import { Select } from "@/components/ui/Select";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { PageHeader } from "@/components/ui/PageHeader";
import { AdminTable, AdminTableHead, AdminTableBody, AdminEmptyRow } from "@/components/admin/AdminTable";
import { AdminStatusBadge } from "@/components/admin/AdminStatusBadge";
import { ProductImagePlaceholder } from "@/components/catalog/ProductImagePlaceholder";
import { getMainWarehouse, isLowStock } from "@/lib/inventory";

interface AdminInventoryPageProps {
  searchParams: Promise<{
    q?: string;
    category?: string;
    brand?: string;
    lowStock?: string;
    active?: string;
    sort?: string;
  }>;
}

type SortOption = "lowest" | "highest" | "newest" | "name";

export default async function AdminInventoryPage({ searchParams }: AdminInventoryPageProps) {
  const { q, category, brand, lowStock, active, sort } = await searchParams;
  const trimmedQuery = q?.trim();
  const sortOption: SortOption = sort === "highest" || sort === "newest" || sort === "name" ? sort : "lowest";

  const [warehouse, categories, brands] = await Promise.all([
    getMainWarehouse(),
    prisma.category.findMany({ orderBy: { name: "asc" } }),
    prisma.brand.findMany({ orderBy: { name: "asc" } }),
  ]);

  const products = await prisma.product.findMany({
    where: {
      ...(category ? { categoryId: category } : {}),
      ...(brand ? { brandId: brand } : {}),
      ...(active === "active" ? { isActive: true } : {}),
      ...(active === "inactive" ? { isActive: false } : {}),
      ...(trimmedQuery
        ? { OR: [{ name: { contains: trimmedQuery } }, { sku: { contains: trimmedQuery } }] }
        : {}),
    },
    select: {
      id: true,
      sku: true,
      name: true,
      isActive: true,
      createdAt: true,
      category: { select: { name: true, nameAr: true } },
      brand: { select: { name: true } },
      images: {
        select: { url: true, altText: true },
        orderBy: [{ isMain: "desc" }, { sortOrder: "asc" }],
        take: 1,
      },
      inventoryItems: {
        where: { locationId: warehouse.id },
        select: { quantity: true },
      },
    },
  });

  let rows = products.map((product) => ({
    ...product,
    stock: product.inventoryItems[0]?.quantity ?? 0,
  }));

  if (lowStock === "1") {
    rows = rows.filter((row) => isLowStock(row.stock));
  }

  rows = rows.sort((a, b) => {
    switch (sortOption) {
      case "highest":
        return b.stock - a.stock;
      case "newest":
        return b.createdAt.getTime() - a.createdAt.getTime();
      case "name":
        return a.name.localeCompare(b.name);
      case "lowest":
      default:
        return a.stock - b.stock;
    }
  });

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="المخزون"
        subtitle={`مستوى المخزون الحالي في ${warehouse.name}`}
        actions={
          <>
            <Link href="/admin/inventory/movements">
              <Button variant="outline">سجل الحركات</Button>
            </Link>
            <Link href="/admin/inventory/adjust">
              <Button>تعديل مخزون</Button>
            </Link>
          </>
        }
      />

      <form
        method="GET"
        className="grid grid-cols-1 gap-4 rounded-card border border-navy-soft bg-navy-surface p-4 sm:grid-cols-2 lg:grid-cols-6"
      >
        <div className="lg:col-span-2">
          <Input name="q" label="بحث بالاسم أو رمز المنتج" defaultValue={trimmedQuery ?? ""} />
        </div>

        <Select name="category" label="القسم" defaultValue={category ?? ""}>
          <option value="">كل الأقسام</option>
          {categories.map((c) => (
            <option key={c.id} value={c.id}>
              {c.nameAr ?? c.name}
            </option>
          ))}
        </Select>

        <Select name="brand" label="العلامة التجارية" defaultValue={brand ?? ""}>
          <option value="">كل العلامات</option>
          {brands.map((b) => (
            <option key={b.id} value={b.id}>
              {b.name}
            </option>
          ))}
        </Select>

        <Select name="active" label="الحالة" defaultValue={active ?? ""}>
          <option value="">الكل</option>
          <option value="active">مفعّل</option>
          <option value="inactive">متوقف</option>
        </Select>

        <Select name="sort" label="الترتيب" defaultValue={sortOption}>
          <option value="lowest">الأقل مخزوناً</option>
          <option value="highest">الأعلى مخزوناً</option>
          <option value="newest">الأحدث</option>
          <option value="name">الاسم</option>
        </Select>

        <label className="flex items-end gap-2 text-sm text-neutral-bg/80">
          <input type="checkbox" name="lowStock" value="1" defaultChecked={lowStock === "1"} className="h-4 w-4" />
          مخزون منخفض فقط
        </label>

        <div className="flex items-end lg:col-span-6">
          <Button type="submit">تصفية</Button>
        </div>
      </form>

      <AdminTable>
        <AdminTableHead>
          <th className="px-4 py-3 text-start"></th>
          <th className="px-4 py-3 text-start">الاسم</th>
          <th className="px-4 py-3 text-start">SKU</th>
          <th className="px-4 py-3 text-start">القسم</th>
          <th className="px-4 py-3 text-start">العلامة</th>
          <th className="px-4 py-3 text-start">المخزون</th>
          <th className="px-4 py-3 text-start">الحالة</th>
          <th className="px-4 py-3 text-start"></th>
        </AdminTableHead>
        <AdminTableBody>
          {rows.map((row) => {
            const thumbnail = row.images[0];
            const lowStockRow = isLowStock(row.stock);
            return (
              <tr key={row.id}>
                <td className="px-4 py-3">
                  <div className="h-12 w-12 overflow-hidden rounded-card">
                    {thumbnail ? (
                      // eslint-disable-next-line @next/next/no-img-element -- arbitrary admin-entered external URLs
                      <img
                        src={thumbnail.url}
                        alt={thumbnail.altText ?? row.name}
                        className="h-full w-full object-cover"
                    loading="lazy"
                      />
                    ) : (
                      <ProductImagePlaceholder className="h-full w-full" />
                    )}
                  </div>
                </td>
                <td className="px-4 py-3 text-neutral-bg">{row.name}</td>
                <td className="px-4 py-3 text-neutral-bg/70">{row.sku}</td>
                <td className="px-4 py-3 text-neutral-bg/70">
                  {row.category?.nameAr ?? row.category?.name ?? "—"}
                </td>
                <td className="px-4 py-3 text-neutral-bg/70">{row.brand?.name ?? "—"}</td>
                <td className="px-4 py-3">
                  <div className="flex items-center gap-2">
                    <span className="text-neutral-bg">{row.stock}</span>
                    {lowStockRow && <Badge variant="warning">مخزون منخفض</Badge>}
                  </div>
                </td>
                <td className="px-4 py-3">
                  <AdminStatusBadge isActive={row.isActive} />
                </td>
                <td className="px-4 py-3">
                  <div className="flex items-center justify-end gap-3">
                    <Link
                      href={`/admin/inventory/adjust?productId=${row.id}`}
                      className="text-sm text-gold-champagne hover:underline"
                    >
                      تعديل
                    </Link>
                    <Link
                      href={`/admin/inventory/movements?productId=${row.id}`}
                      className="text-sm text-gold-champagne hover:underline"
                    >
                      السجل
                    </Link>
                  </div>
                </td>
              </tr>
            );
          })}
          {rows.length === 0 && <AdminEmptyRow colSpan={8} message="لا توجد منتجات مطابقة" />}
        </AdminTableBody>
      </AdminTable>
    </div>
  );
}
