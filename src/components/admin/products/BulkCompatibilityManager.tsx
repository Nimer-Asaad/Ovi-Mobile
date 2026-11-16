"use client";

import { useActionState, useMemo, useState } from "react";
import { addCompatibilityAction, removeCompatibilityAction, type CompatibilityActionState } from "@/app/admin/products/compatibility/actions";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Select } from "@/components/ui/Select";
import { Spinner } from "@/components/ui/Spinner";
import { CompatibilityModelPicker } from "@/components/admin/products/CompatibilityModelPicker";
import { MAX_COMPATIBILITY_PRODUCTS } from "@/lib/compatibility-limits";
import type { CompatibilityBrandOption } from "@/lib/product-phone-compatibility";

export interface BulkCompatibilityProduct {
  id: string;
  sku: string;
  name: string;
  categoryId: string | null;
  categoryName: string | null;
  /** PhoneModel ids this product is currently linked to. */
  modelIds: string[];
}

export interface BulkCompatibilityManagerProps {
  products: BulkCompatibilityProduct[];
  categories: { id: string; label: string }[];
  brands: CompatibilityBrandOption[];
  /** PhoneModel id → "brand — model" label. */
  modelLabels: Record<string, string>;
}

const initialState: CompatibilityActionState = {};

/** Bulk "توافق الأجهزة": tick several products, tick the phone models they
 * fit, press إضافة (or إزالة). One explicit admin choice per mapping — nothing
 * is inferred from names. METADATA ONLY: neither button can change stock,
 * status, variant mode or tracking mode (see addProductCompatibility). */
export function BulkCompatibilityManager({ products, categories, brands, modelLabels }: BulkCompatibilityManagerProps) {
  const [search, setSearch] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const [onlyUnlinked, setOnlyUnlinked] = useState(false);
  const [selectedProducts, setSelectedProducts] = useState<string[]>([]);
  const [selectedModels, setSelectedModels] = useState<string[]>([]);
  const [addState, addAction, addPending] = useActionState(addCompatibilityAction, initialState);
  const [removeState, removeAction, removePending] = useActionState(removeCompatibilityAction, initialState);

  const visibleProducts = useMemo(() => {
    const query = search.trim().toLowerCase();
    return products.filter((product) => {
      if (categoryId && product.categoryId !== categoryId) return false;
      if (onlyUnlinked && product.modelIds.length > 0) return false;
      if (query && !`${product.name} ${product.sku}`.toLowerCase().includes(query)) return false;
      return true;
    });
  }, [products, search, categoryId, onlyUnlinked]);

  const selectedProductSet = useMemo(() => new Set(selectedProducts), [selectedProducts]);
  const allVisibleSelected = visibleProducts.length > 0 && visibleProducts.every((product) => selectedProductSet.has(product.id));
  const linkedAmongSelected = useMemo(() => {
    const ids = new Set<string>();
    for (const product of products) if (selectedProductSet.has(product.id)) for (const id of product.modelIds) ids.add(id);
    return ids;
  }, [products, selectedProductSet]);

  function toggleProduct(id: string) {
    setSelectedProducts((current) => (current.includes(id) ? current.filter((value) => value !== id) : [...current, id]));
  }
  function toggleAllVisible() {
    const visibleIds = visibleProducts.map((product) => product.id);
    setSelectedProducts((current) => (allVisibleSelected ? current.filter((id) => !visibleIds.includes(id)) : [...new Set([...current, ...visibleIds])]));
  }

  const tooManyProducts = selectedProducts.length > MAX_COMPATIBILITY_PRODUCTS;
  const canSubmit = selectedProducts.length > 0 && selectedModels.length > 0 && !tooManyProducts;
  const productsJson = JSON.stringify(selectedProducts);
  const modelsJson = JSON.stringify(selectedModels);

  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
      <Card>
        <CardHeader>
          <CardTitle>1) اختر المنتجات</CardTitle>
          <span className="text-xs text-neutral-bg/60">المحدد: {selectedProducts.length}</span>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Input label="بحث بالاسم أو الرمز" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="ابحث..." />
            <Select label="القسم" value={categoryId} onChange={(event) => setCategoryId(event.target.value)}>
              <option value="">كل الأقسام</option>
              {categories.map((category) => (
                <option key={category.id} value={category.id}>
                  {category.label}
                </option>
              ))}
            </Select>
          </div>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <label className="flex items-center gap-2 text-sm text-neutral-bg/80">
              <input type="checkbox" className="h-4 w-4" checked={onlyUnlinked} onChange={(event) => setOnlyUnlinked(event.target.checked)} />
              المنتجات غير المربوطة فقط
            </label>
            <div className="flex items-center gap-2">
              <Button type="button" variant="outline" size="sm" onClick={toggleAllVisible} disabled={visibleProducts.length === 0}>
                {allVisibleSelected ? "إلغاء تحديد المعروض" : `تحديد المعروض (${visibleProducts.length})`}
              </Button>
              {selectedProducts.length > 0 && (
                <Button type="button" variant="ghost" size="sm" onClick={() => setSelectedProducts([])}>
                  مسح التحديد
                </Button>
              )}
            </div>
          </div>

          <div className="max-h-[32rem] divide-y divide-navy-soft overflow-y-auto rounded-card border border-navy-soft bg-navy-deep">
            {visibleProducts.length === 0 ? (
              <p className="p-4 text-center text-sm text-neutral-bg/50">لا توجد منتجات مطابقة</p>
            ) : (
              visibleProducts.map((product) => {
                const labels = product.modelIds.map((id) => modelLabels[id]).filter(Boolean);
                return (
                  <label key={product.id} className="flex cursor-pointer items-start gap-3 px-3 py-2 hover:bg-navy-soft/30">
                    <input type="checkbox" className="mt-1 h-4 w-4" checked={selectedProductSet.has(product.id)} onChange={() => toggleProduct(product.id)} />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm text-neutral-bg">{product.name}</span>
                      <span className="block text-[11px] text-neutral-bg/50">
                        {product.sku}
                        {product.categoryName ? ` · ${product.categoryName}` : ""}
                      </span>
                      <span className="block text-[11px] text-neutral-bg/60">
                        {labels.length === 0 ? "غير مربوط بأي موديل" : `مربوط بـ ${labels.length}: ${labels.slice(0, 3).join("، ")}${labels.length > 3 ? " …" : ""}`}
                      </span>
                    </span>
                  </label>
                );
              })
            )}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>2) اختر الموديلات المتوافقة</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <CompatibilityModelPicker brands={brands} selected={selectedModels} onChange={setSelectedModels} linkedModelIds={linkedAmongSelected} />

          <div className="rounded-card border border-navy-soft bg-navy-deep p-3 text-xs text-neutral-bg/70">
            سيتم تطبيق <strong>{selectedModels.length}</strong> موديل على <strong>{selectedProducts.length}</strong> منتج. هذا تصنيف للبحث فقط — لا يغيّر المخزون ولا حالة المنتج ولا طريقة تتبّعه.
          </div>
          {tooManyProducts && (
            <p className="text-sm text-rose-600" role="alert">
              الحد الأقصى {MAX_COMPATIBILITY_PRODUCTS} منتج في العملية الواحدة
            </p>
          )}

          <div className="flex flex-wrap gap-3">
            <form action={addAction}>
              <input type="hidden" name="productIds" value={productsJson} />
              <input type="hidden" name="phoneModelIds" value={modelsJson} />
              <Button type="submit" disabled={!canSubmit || addPending || removePending}>
                {addPending && <Spinner />}
                إضافة التوافق للمنتجات المحددة
              </Button>
            </form>
            <form action={removeAction}>
              <input type="hidden" name="productIds" value={productsJson} />
              <input type="hidden" name="phoneModelIds" value={modelsJson} />
              <Button type="submit" variant="outline" className="text-rose-600 hover:bg-rose-50" disabled={!canSubmit || addPending || removePending}>
                {removePending && <Spinner />}
                إزالة التوافق من المنتجات المحددة
              </Button>
            </form>
          </div>

          {(addState.error || removeState.error) && (
            <p className="text-sm text-rose-600" role="alert">
              {addState.error ?? removeState.error}
            </p>
          )}
          {(addState.success || removeState.success) && <p className="text-sm text-emerald-600">{addState.success ?? removeState.success}</p>}
        </CardContent>
      </Card>
    </div>
  );
}
