import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { Button } from "@/components/ui/Button";
import { PageHeader } from "@/components/ui/PageHeader";
import { AdminProductsSearch, type AdminProductRow } from "@/components/admin/products/AdminProductsSearch";
import { toggleProductActive } from "./actions";

export default async function AdminProductsPage() {
  const products = await prisma.product.findMany({
    orderBy: { createdAt: "desc" },
    include: {
      category: { select: { name: true, nameAr: true } },
      brand: { select: { name: true } },
      supplier: { select: { name: true } },
      // Main Warehouse stock only — rep-assigned stock is tracked separately under /admin/reps.
      inventoryItems: { where: { location: { isDefault: true } }, select: { quantity: true } },
      // Main is always enforced IMAGE on save; filter defensively so a
      // thumbnail <img> can never receive a video url.
      images: {
        where: { mediaType: "IMAGE" },
        select: { url: true, altText: true },
        orderBy: [{ isMain: "desc" }, { sortOrder: "asc" }],
        take: 1,
      },
    },
  });

  const rows: AdminProductRow[] = products.map((product) => ({
    id: product.id,
    sku: product.sku,
    name: product.name,
    nameAr: product.nameAr,
    isFeatured: product.isFeatured,
    isActive: product.isActive,
    categoryName: product.category?.nameAr ?? product.category?.name ?? null,
    brandName: product.brand?.name ?? null,
    supplierName: product.supplier?.name ?? null,
    stock: product.inventoryItems.reduce((sum, item) => sum + item.quantity, 0),
    retailPriceCents: product.retailPriceCents,
    wholesalePriceCents: product.wholesalePriceCents,
    // Thumbnail is always the main image (isMain items are enforced IMAGE-only server-side).
    thumbnail: product.images[0] ?? null,
    toggleAction: toggleProductActive.bind(null, product.id),
  }));

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="المنتجات"
        subtitle="إدارة كتالوج المنتجات"
        actions={
          <Link href="/admin/products/new">
            <Button>إضافة منتج</Button>
          </Link>
        }
      />

      <AdminProductsSearch products={rows} />
    </div>
  );
}
