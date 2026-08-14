"use client";

import { useActionState, useState } from "react";
import Link from "next/link";
import type { Brand, Category, Color, Product, ProductImage, Supplier } from "@prisma/client";
import { createProduct, updateProduct, updateInventoryTrackingMode, type ProductFormState } from "./actions";
import { PRODUCT_INVENTORY_TRACKING_MODES } from "@/lib/constants";
import { Input } from "@/components/ui/Input";
import { Select } from "@/components/ui/Select";
import { Textarea } from "@/components/ui/Textarea";
import { Button } from "@/components/ui/Button";
import { ProductMediaUploader } from "@/components/admin/products/ProductMediaUploader";

const TRACKING_MODE_LABELS: Record<string, string> = {
  [PRODUCT_INVENTORY_TRACKING_MODES.TOTAL_STOCK]: "مخزون إجمالي (بدون نوع جهاز أو لون)",
  [PRODUCT_INVENTORY_TRACKING_MODES.DEVICE_MODEL_COLOR]: "مخزون حسب نوع الجهاز واللون",
};

function TrackingModeConversionForm({ productId, currentMode }: { productId: string; currentMode: string }) {
  const targetMode = currentMode === PRODUCT_INVENTORY_TRACKING_MODES.TOTAL_STOCK
    ? PRODUCT_INVENTORY_TRACKING_MODES.DEVICE_MODEL_COLOR
    : PRODUCT_INVENTORY_TRACKING_MODES.TOTAL_STOCK;
  const [state, action, pending] = useActionState(updateInventoryTrackingMode.bind(null, productId), {});

  return (
    <form action={action} className="flex flex-col gap-2 rounded-card border border-amber-500/30 bg-navy-deep/40 p-3">
      <input type="hidden" name="inventoryTrackingMode" value={targetMode} />
      <p className="text-xs text-neutral-bg/60">
        الوضع الحالي: <span className="text-neutral-bg">{TRACKING_MODE_LABELS[currentMode]}</span>
      </p>
      <Button type="submit" variant="outline" size="sm" disabled={pending} className="self-start">
        {pending ? "جارٍ التحويل..." : `تحويل إلى: ${TRACKING_MODE_LABELS[targetMode]}`}
      </Button>
      {state.error && <p className="text-sm text-rose-500">{state.error}</p>}
      {state.success && <p className="text-sm text-emerald-500">{state.success}</p>}
    </form>
  );
}

interface ProductFormProps {
  categories: Category[];
  brands: Brand[];
  suppliers: Supplier[];
  colors: Color[];
  product?: Product;
  currentStock?: number;
  images?: ProductImage[];
  selectedColorIds?: string[];
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
  colors,
  product,
  currentStock,
  images = [],
  selectedColorIds = [],
}: ProductFormProps) {
  const action = product ? updateProduct.bind(null, product.id) : createProduct;
  const [state, formAction, isPending] = useActionState(action, initialState);
  const [usesPhoneVariants, setUsesPhoneVariants] = useState(false);
  const [newProductTrackingMode, setNewProductTrackingMode] = useState<string>(PRODUCT_INVENTORY_TRACKING_MODES.TOTAL_STOCK);

  const sortedImages = [...images].sort((a, b) => (a.isMain === b.isMain ? a.sortOrder - b.sortOrder : a.isMain ? -1 : 1));

  return (
    <div className="flex max-w-5xl flex-col gap-5">
      {/* This <form> uses display:contents (see className) so its children
       * lay out exactly as if this wrapper weren't here — it exists only to
       * scope which fields submit via formAction. TrackingModeConversionForm
       * below renders its own independent <form> for a different action; it
       * must never be a descendant of this one, since HTML doesn't allow
       * nested <form> elements (React throws "A React form was unexpectedly
       * submitted" at runtime when it happens) — see the standalone section
       * after this form closes. */}
      <form action={formAction} className="contents">
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
            cloudinaryPublicId: image.cloudinaryPublicId,
          }))}
          error={state.fieldErrors?.media}
        />
      </FormSection>

      <FormSection title="الألوان المتاحة">
        {colors.length === 0 ? (
          <p className="text-sm text-neutral-bg/60">
            لا توجد ألوان بعد — أضِف ألواناً من صفحة{" "}
            <a href="/admin/colors" className="text-gold-champagne hover:underline">
              الألوان
            </a>{" "}
            ثم عد إلى هنا لربطها بهذا المنتج.
          </p>
        ) : (
          <>
            <p className="text-sm text-neutral-bg/60">
              اختر الألوان التي يتوفر بها هذا المنتج تحديداً — لا داعي لتحديد كل الألوان، فقط ما هو متاح فعلاً.
              اترك الكل بدون تحديد إن كان المنتج بلون واحد فقط.
            </p>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4">
              {colors.map((color) => (
                <label key={color.id} className="flex items-center gap-2 text-sm text-neutral-bg/80">
                  <input
                    type="checkbox"
                    name="colorIds"
                    value={color.id}
                    defaultChecked={selectedColorIds.includes(color.id)}
                    className="h-4 w-4 rounded border-navy-soft bg-navy-deep text-gold-champagne focus-visible:ring-gold-champagne"
                  />
                  {color.hexCode && (
                    <span
                      aria-hidden="true"
                      className="h-4 w-4 shrink-0 rounded-full border border-navy-soft"
                      style={{ backgroundColor: color.hexCode }}
                    />
                  )}
                  {color.nameAr ?? color.name}
                </label>
              ))}
            </div>
          </>
        )}
      </FormSection>

      {!product && (
        <FormSection title="طريقة تتبّع المخزون">
          <p className="text-sm text-neutral-bg/60">
            اختر كيف يُدار مخزون هذا المنتج. مخزون إجمالي: كمية واحدة عادية (شواحن، كوابل، سماعات...). مخزون حسب
            الجهاز واللون: كمية مستقلة لكل تركيبة ماركة + موديل + لون (جفرات ومنتجات مشابهة). لا يمكن الجمع بينه
            وبين نظام توافق الهواتف القديم أدناه.
          </p>
          <div className="flex flex-col gap-2">
            <label className="flex items-center gap-2 text-sm text-neutral-bg/80">
              <input
                type="radio"
                name="inventoryTrackingMode"
                value={PRODUCT_INVENTORY_TRACKING_MODES.TOTAL_STOCK}
                checked={newProductTrackingMode === PRODUCT_INVENTORY_TRACKING_MODES.TOTAL_STOCK}
                onChange={() => setNewProductTrackingMode(PRODUCT_INVENTORY_TRACKING_MODES.TOTAL_STOCK)}
                className="h-4 w-4"
              />
              {TRACKING_MODE_LABELS[PRODUCT_INVENTORY_TRACKING_MODES.TOTAL_STOCK]}
            </label>
            <label className="flex items-center gap-2 text-sm text-neutral-bg/80">
              <input
                type="radio"
                name="inventoryTrackingMode"
                value={PRODUCT_INVENTORY_TRACKING_MODES.DEVICE_MODEL_COLOR}
                checked={newProductTrackingMode === PRODUCT_INVENTORY_TRACKING_MODES.DEVICE_MODEL_COLOR}
                disabled={usesPhoneVariants}
                onChange={() => setNewProductTrackingMode(PRODUCT_INVENTORY_TRACKING_MODES.DEVICE_MODEL_COLOR)}
                className="h-4 w-4"
              />
              {TRACKING_MODE_LABELS[PRODUCT_INVENTORY_TRACKING_MODES.DEVICE_MODEL_COLOR]}
              {newProductTrackingMode === PRODUCT_INVENTORY_TRACKING_MODES.DEVICE_MODEL_COLOR && (
                <span className="text-xs text-neutral-bg/50">(سيتم فتح شاشة تركيبات المخزون بعد الحفظ)</span>
              )}
            </label>
          </div>
        </FormSection>
      )}

      {product && product.inventoryTrackingMode !== PRODUCT_INVENTORY_TRACKING_MODES.DEVICE_MODEL_COLOR && (
        <FormSection title="التوافق مع موديلات الهواتف والـVariants">
          <p className="text-sm text-neutral-bg/60">
            نظام قديم منفصل — الماركة والموديل فقط بدون لون. للكفرات وحمايات الشاشة والعدسات: عرّف الماركة والموديل
            لكل Variant، ثم وزّع المخزون القديم يدوياً دون تغيير مجموعه.
          </p>
          <div className="flex flex-wrap items-center gap-3">
            <Link href={`/admin/products/${product.id}/variants`}><Button type="button" variant="secondary">إدارة الـVariants وتوزيع المخزون</Button></Link>
            <span className="text-xs text-neutral-bg/50">الحالة: {product.variantAllocationStatus}</span>
          </div>
        </FormSection>
      )}

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
        {!product && (
          <label className="flex items-center gap-2 text-sm text-neutral-bg/80">
            <input
              type="checkbox"
              name="usesPhoneVariants"
              checked={usesPhoneVariants}
              onChange={(event) => {
                setUsesPhoneVariants(event.target.checked);
                if (event.target.checked) setNewProductTrackingMode(PRODUCT_INVENTORY_TRACKING_MODES.TOTAL_STOCK);
              }}
              className="h-4 w-4"
            />
            هذا المنتج يحتاج توافق ماركة + موديل هاتف (نظام قديم بدون لون — سيتم فتح محرر الـVariants بعد الحفظ)
          </label>
        )}
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

      {/* Deliberately outside the <form> above — see the comment on that
       * form's opening tag. TrackingModeConversionForm below renders its
       * own independent <form>, which must never nest inside another one. */}
      {product && (
        <FormSection title="طريقة تتبّع المخزون">
          {product.variantMode === "PHONE_COMPATIBILITY" ? (
            <p className="text-sm text-neutral-bg/60">
              هذا المنتج يستخدم نظام توافق الهواتف القديم (Variants) — لا يمكن تحويله إلى مخزون الجهاز واللون في
              هذه المرحلة.
            </p>
          ) : (
            <>
              <TrackingModeConversionForm productId={product.id} currentMode={product.inventoryTrackingMode} />
              {product.inventoryTrackingMode === PRODUCT_INVENTORY_TRACKING_MODES.DEVICE_MODEL_COLOR && (
                <Link href={`/admin/products/${product.id}/device-inventory`}>
                  <Button type="button" variant="secondary">إدارة تركيبات مخزون الجهاز واللون</Button>
                </Link>
              )}
            </>
          )}
        </FormSection>
      )}
    </div>
  );
}
