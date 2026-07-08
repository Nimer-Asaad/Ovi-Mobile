import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { getBrandOptions, getCategoryOptions, getSupplierOptions } from "../../options";
import { ProductForm } from "../../ProductForm";

interface EditProductPageProps {
  params: Promise<{ id: string }>;
}

export default async function EditProductPage({ params }: EditProductPageProps) {
  const { id } = await params;

  const product = await prisma.product.findUnique({
    where: { id },
    include: {
      inventoryItems: { select: { quantity: true } },
      images: { orderBy: [{ isMain: "desc" }, { sortOrder: "asc" }] },
    },
  });
  if (!product) notFound();

  const [categories, brands, suppliers] = await Promise.all([
    getCategoryOptions(product.categoryId),
    getBrandOptions(product.brandId),
    getSupplierOptions(product.supplierId),
  ]);

  const currentStock = product.inventoryItems.reduce((sum, item) => sum + item.quantity, 0);

  return (
    <div className="flex flex-col gap-6">
      <h2 className="text-xl font-semibold text-neutral-bg">تعديل المنتج</h2>
      <ProductForm
        categories={categories}
        brands={brands}
        suppliers={suppliers}
        product={product}
        currentStock={currentStock}
        images={product.images}
      />
    </div>
  );
}
