"use client";

import { useActionState } from "react";
import type { Brand, Category, Product, ProductImage, Supplier } from "@prisma/client";
import { createProduct, updateProduct, type ProductFormState } from "./actions";
import { Input } from "@/components/ui/Input";
import { Select } from "@/components/ui/Select";
import { Textarea } from "@/components/ui/Textarea";
import { Button } from "@/components/ui/Button";
import { ProductMediaUploader } from "@/components/admin/products/ProductMediaUploader";

interface ProductFormProps {
  categories: Category[];
  brands: Brand[];
  suppliers: Supplier[];
  product?: Product;
  currentStock?: number;
  images?: ProductImage[];
}

const initialState: ProductFormState = {};

function centsToInput(cents: number | null | undefined): string {
  return cents === null || cents === undefined ? "" : (cents / 100).toFixed(2);
}

function FormSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-4 rounded-card border border-navy-soft bg-navy-surface p-5 sm:p-6">
      <h3 className="text-sm font-semibold text-neutral-bg">{title}</h3>
      {children}
    </section>
  );
}

export function ProductForm({
  categories,
  brands,
  suppliers,
  product,
  currentStock,
  images = [],
}: ProductFormProps) {
  const action = product ? updateProduct.bind(null, product.id) : createProduct;
  const [state, formAction, isPending] = useActionState(action, initialState);

  const sortedImages = [...images].sort((a, b) => (a.isMain === b.isMain ? a.sortOrder - b.sortOrder : a.isMain ? -1 : 1));

  return (
    <form action={formAction} className="flex max-w-5xl flex-col gap-5">
      <FormSection title="المعلومات الأساسية">
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <Input name="name" label="اسم المنتج" defaultValue={product?.name} required error={state.fieldErrors?.name} />
          <Input
            name="nameAr"
            label="الاسم بالعربية (اختياري)"
            defaultValue={product?.nameAr ?? ""}
            error={state.fieldErrors?.nameAr}
          />
        </div>
        <Input name="sku" label="رمز المنتج (SKU)" defaultValue={product?.sku} required error={state.fieldErrors?.sku} />
      </FormSection>

      <FormSection title="القسم والعلامة التجارية والمورد">
        <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
          <Select name="categoryId" label="القسم" defaultValue={product?.categoryId ?? ""} required error={state.fieldErrors?.categoryId}>
            <option value="">اختر القسم</option>
            {categories.map((category) => (
              <option key={category.id} value={category.id}>
                {category.nameAr ?? category.name}
              </option>
            ))}
          </Select>

          <Select name="brandId" label="العلامة التجارية" defaultValue={product?.brandId ?? ""} required error={state.fieldErrors?.brandId}>
            <option value="">اختر العلامة</option>
            {brands.map((brand) => (
              <option key={brand.id} value={brand.id}>
                {brand.name}
              </option>
            ))}
          </Select>

          <Select name="supplierId" label="المورد (اختياري)" defaultValue={product?.supplierId ?? ""}>
            <option value="">بدون مورد</option>
            {suppliers.map((supplier) => (
              <option key={supplier.id} value={supplier.id}>
                {supplier.name}
              </option>
            ))}
          </Select>
        </div>
      </FormSection>

      <FormSection title="التسعير">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <Input
            name="retailPriceCents"
            type="number"
            step="0.01"
            min="0"
            label="سعر التجزئة (₪)"
            defaultValue={centsToInput(product?.retailPriceCents)}
            required
            error={state.fieldErrors?.retailPriceCents}
          />
          <Input
            name="wholesalePriceCents"
            type="number"
            step="0.01"
            min="0"
            label="سعر الجملة (₪)"
            defaultValue={centsToInput(product?.wholesalePriceCents)}
            required
            error={state.fieldErrors?.wholesalePriceCents}
          />
          <Input
            name="costCents"
            type="number"
            step="0.01"
            min="0"
            label="سعر التكلفة (اختياري) (₪)"
            defaultValue={centsToInput(product?.costCents)}
            error={state.fieldErrors?.costCents}
          />
        </div>

        {product && (
          <p className="text-sm text-neutral-bg/60">
            المخزون الحالي: <span className="text-neutral-bg">{currentStock ?? 0}</span> — يُدار من صفحة المخزون،
            غير قابل للتعديل هنا.
          </p>
        )}
      </FormSection>

      <FormSection title="الوصف">
        <Textarea
          name="description"
          label="الوصف (اختياري)"
          defaultValue={product?.description ?? ""}
          error={state.fieldErrors?.description}
        />
      </FormSection>

      <FormSection title="الوسائط (صور وفيديوهات)">
        <ProductMediaUploader
          existingMedia={sortedImages.map((image) => ({
            url: image.url,
            mediaType: image.mediaType,
            altText: image.altText,
          }))}
          error={state.fieldErrors?.media}
        />
      </FormSection>

      <FormSection title="الحالة">
        <label className="flex items-center gap-2 text-sm text-neutral-bg/80">
          <input
            type="checkbox"
            name="isFeatured"
            defaultChecked={product?.isFeatured}
            className="h-4 w-4 rounded border-navy-soft bg-navy-deep text-gold-champagne focus-visible:ring-gold-champagne"
          />
          منتج مميز
        </label>
      </FormSection>

      {state.error && (
        <p className="text-sm text-rose-600" role="alert">
          {state.error}
        </p>
      )}

      <Button type="submit" disabled={isPending} className="self-start">
        {isPending ? "جارٍ الحفظ..." : product ? "حفظ التعديلات" : "إضافة المنتج"}
      </Button>
    </form>
  );
}
