import { getBrandOptions, getCategoryOptions, getColorOptions, getSupplierOptions } from "../options";
import { ProductForm } from "../ProductForm";

export default async function NewProductPage() {
  const [categories, brands, suppliers, colors] = await Promise.all([
    getCategoryOptions(),
    getBrandOptions(),
    getSupplierOptions(),
    getColorOptions(),
  ]);

  return (
    <div className="flex flex-col gap-6">
      <h2 className="text-xl font-semibold text-neutral-bg">إضافة منتج</h2>
      <ProductForm categories={categories} brands={brands} suppliers={suppliers} colors={colors} />
    </div>
  );
}
