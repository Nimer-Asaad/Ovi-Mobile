import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { getBrandOptions, getCategoryOptions, getColorOptions, getSupplierOptions } from "../../options";
import { ProductForm } from "../../ProductForm";
import { ProductCompatibilityManager } from "@/components/admin/products/ProductCompatibilityManager";
import { getCompatibilityBrandOptions, getProductCompatibilityLinks } from "@/lib/product-phone-compatibility";

interface EditProductPageProps {
  params: Promise<{ id: string }>;
}

export default async function EditProductPage({ params }: EditProductPageProps) {
  const { id } = await params;

  const product = await prisma.product.findUnique({
    where: { id },
    include: {
      // Main Warehouse stock only — rep-assigned stock is tracked separately under /admin/reps.
      inventoryItems: { where: { location: { isDefault: true } }, select: { quantity: true } },
      images: { orderBy: [{ isMain: "desc" }, { sortOrder: "asc" }] },
      colorOptions: { select: { colorId: true } },
    },
  });
  if (!product) notFound();

  const selectedColorIds = product.colorOptions.map((option) => option.colorId);

  const [categories, brands, suppliers, colors, compatibilityBrands, compatibilityLinks] = await Promise.all([
    getCategoryOptions(product.categoryId),
    getBrandOptions(product.brandId),
    getSupplierOptions(product.supplierId),
    getColorOptions(selectedColorIds),
    // Isolated reads: the original product query above is untouched, and with
    // the compatibility table not deployed yet the links come back null and the
    // section is simply not shown.
    getCompatibilityBrandOptions(),
    getProductCompatibilityLinks(id),
  ]);

  const currentStock = product.inventoryItems.reduce((sum, item) => sum + item.quantity, 0);

  return (
    <div className="flex flex-col gap-6">
      <h2 className="text-xl font-semibold text-neutral-bg">تعديل المنتج</h2>
      <ProductForm
        categories={categories}
        brands={brands}
        suppliers={suppliers}
        colors={colors}
        product={product}
        currentStock={currentStock}
        images={product.images}
        selectedColorIds={selectedColorIds}
      />
      {compatibilityLinks && <ProductCompatibilityManager productId={product.id} brands={compatibilityBrands} linked={compatibilityLinks} />}
    </div>
  );
}
