import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { Select } from "@/components/ui/Select";
import { Button } from "@/components/ui/Button";
import { PageHeader } from "@/components/ui/PageHeader";
import { InventoryLiveSearch, type AdminInventoryRow } from "@/components/admin/inventory/InventoryLiveSearch";
import { getMainWarehouse, isLowStock } from "@/lib/inventory";

interface AdminInventoryPageProps {
  searchParams: Promise<{
    category?: string;
    brand?: string;
    lowStock?: string;
    active?: string;
    sort?: string;
  }>;
}

type SortOption = "lowest" | "highest" | "newest" | "name";

export default async function AdminInventoryPage({ searchParams }: AdminInventoryPageProps) {
  const { category, brand, lowStock, active, sort } = await searchParams;
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
        where: { mediaType: "IMAGE" },
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

  const inventoryRows: AdminInventoryRow[] = rows.map((row) => ({
    id: row.id,
    sku: row.sku,
    name: row.name,
    categoryName: row.category?.nameAr ?? row.category?.name ?? null,
    brandName: row.brand?.name ?? null,
    stock: row.stock,
    isActive: row.isActive,
    isLowStockRow: isLowStock(row.stock),
    thumbnail: row.images[0] ?? null,
  }));

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
        className="grid grid-cols-1 gap-4 rounded-card border border-navy-soft bg-navy-surface p-4 sm:grid-cols-2 lg:grid-cols-5"
      >
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

        <div className="flex items-end lg:col-span-5">
          <Button type="submit">تصفية</Button>
        </div>
      </form>

      <InventoryLiveSearch rows={inventoryRows} />
    </div>
  );
}
