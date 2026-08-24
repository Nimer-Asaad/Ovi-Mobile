"use client";

import { useMemo, useState } from "react";
import { Input } from "@/components/ui/Input";
import { Select } from "@/components/ui/Select";
import { Badge } from "@/components/ui/Badge";
import { ProductThumbnail } from "@/components/catalog/ProductThumbnail";
import { ProductImagePlaceholder } from "@/components/catalog/ProductImagePlaceholder";
import { LOW_STOCK_THRESHOLD } from "@/lib/constants";
import type { InventoryOverviewLocation, InventoryOverviewProduct, InventoryOverviewDimensionGroup } from "@/lib/inventory-overview";

export interface CompanyInventoryOverviewProps {
  locations: InventoryOverviewLocation[];
  categories: { id: string; label: string }[];
  products: InventoryOverviewProduct[];
}

type Scope = "COMPANY" | "WAREHOUSE" | "REP_CARS" | "REP";
type SortOption = "name" | "highest" | "lowest";

function sumRecord(record: Record<string, number>, locationIds: string[] | null): number {
  if (locationIds === null) {
    return Object.values(record).reduce((sum, q) => sum + q, 0);
  }
  return locationIds.reduce((sum, id) => sum + (record[id] ?? 0), 0);
}

function scopeLabel(scope: Scope, repName: string | null): string {
  switch (scope) {
    case "WAREHOUSE":
      return "المخزن";
    case "REP_CARS":
      return "سيارات المندوبين";
    case "REP":
      return repName ? `سيارة ${repName}` : "سيارة مندوب محدد";
    case "COMPANY":
    default:
      return "الشركة كاملة";
  }
}

interface BrandGroup {
  brandId: string;
  brandLabel: string;
  models: {
    modelId: string;
    modelLabel: string;
    items: InventoryOverviewDimensionGroup[];
  }[];
}

function groupDimensions(groups: InventoryOverviewDimensionGroup[]): BrandGroup[] {
  const byBrand = new Map<string, BrandGroup>();
  for (const group of groups) {
    let brand = byBrand.get(group.brandId);
    if (!brand) {
      brand = { brandId: group.brandId, brandLabel: group.brandLabel, models: [] };
      byBrand.set(group.brandId, brand);
    }
    let model = brand.models.find((m) => m.modelId === group.modelId);
    if (!model) {
      model = { modelId: group.modelId, modelLabel: group.modelLabel, items: [] };
      brand.models.push(model);
    }
    model.items.push(group);
  }
  return [...byBrand.values()];
}

/** Visual, read-only stock catalog for ADMIN/ADMIN_ASSISTANT — every number
 * shown here is a pre-computed field already handed down from
 * buildInventoryOverviewData (server-side, sourced from InventoryItem rows).
 * This component only selects/sums/sorts/filters those numbers for display;
 * it never recomputes stock itself and never calls a mutation. */
export function CompanyInventoryOverview({ locations, categories, products }: CompanyInventoryOverviewProps) {
  const [scope, setScope] = useState<Scope>("COMPANY");
  const [selectedRepId, setSelectedRepId] = useState("");
  const [search, setSearch] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const [sort, setSort] = useState<SortOption>("name");
  const [showZeroStock, setShowZeroStock] = useState(false);
  const [detailProduct, setDetailProduct] = useState<InventoryOverviewProduct | null>(null);

  const warehouseLocations = useMemo(() => locations.filter((l) => l.type === "WAREHOUSE"), [locations]);
  const repCarLocations = useMemo(() => locations.filter((l) => l.type === "REP_CAR"), [locations]);
  const repOptions = useMemo(
    () =>
      repCarLocations
        .filter((l) => l.repId && l.repName)
        .sort((a, b) => (a.repName ?? "").localeCompare(b.repName ?? "")),
    [repCarLocations],
  );

  const warehouseLocationIds = useMemo(() => warehouseLocations.map((l) => l.id), [warehouseLocations]);
  const repCarLocationIds = useMemo(() => repCarLocations.map((l) => l.id), [repCarLocations]);

  const selectedRepLocation = scope === "REP" ? repCarLocations.find((l) => l.repId === selectedRepId) ?? null : null;

  // null means "every known company location" (used for the unfiltered
  // sumRecord call) — every other scope resolves to a concrete id list.
  const scopeLocationIds: string[] = useMemo(() => {
    switch (scope) {
      case "WAREHOUSE":
        return warehouseLocationIds;
      case "REP_CARS":
        return repCarLocationIds;
      case "REP":
        return selectedRepLocation ? [selectedRepLocation.id] : [];
      case "COMPANY":
      default:
        return [...warehouseLocationIds, ...repCarLocationIds];
    }
  }, [scope, warehouseLocationIds, repCarLocationIds, selectedRepLocation]);

  const visibleProducts = useMemo(() => {
    const trimmedQuery = search.trim().toLowerCase();
    const withScopeTotal = products.map((product) => ({
      product,
      scopeTotal: sumRecord(product.byLocation, scopeLocationIds),
    }));

    let filtered = withScopeTotal.filter(({ product }) => {
      if (categoryId && product.categoryId !== categoryId) return false;
      if (trimmedQuery) {
        const haystack = `${product.name} ${product.nameAr ?? ""} ${product.sku}`.toLowerCase();
        if (!haystack.includes(trimmedQuery)) return false;
      }
      return true;
    });

    if (!showZeroStock) {
      filtered = filtered.filter(({ scopeTotal }) => scopeTotal > 0);
    }

    filtered.sort((a, b) => {
      switch (sort) {
        case "highest":
          return b.scopeTotal - a.scopeTotal;
        case "lowest":
          return a.scopeTotal - b.scopeTotal;
        case "name":
        default:
          return (a.product.nameAr ?? a.product.name).localeCompare(b.product.nameAr ?? b.product.name);
      }
    });

    return filtered;
  }, [products, scopeLocationIds, categoryId, search, showZeroStock, sort]);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-4 rounded-card border border-navy-soft bg-navy-surface p-4">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Select
            label="الموقع"
            value={scope}
            onChange={(event) => {
              setScope(event.target.value as Scope);
              if (event.target.value !== "REP") setSelectedRepId("");
            }}
          >
            <option value="COMPANY">الشركة كاملة</option>
            <option value="WAREHOUSE">المخزن</option>
            <option value="REP_CARS">سيارات المندوبين</option>
            <option value="REP">سيارة مندوب محدد</option>
          </Select>

          {scope === "REP" && (
            <Select label="المندوب" value={selectedRepId} onChange={(event) => setSelectedRepId(event.target.value)}>
              <option value="">— اختر مندوباً —</option>
              {repOptions.map((location) => (
                <option key={location.id} value={location.repId!}>
                  {location.repName}
                  {location.repIsActive === false ? " (غير نشط)" : ""}
                </option>
              ))}
            </Select>
          )}

          <Input
            label="بحث بالاسم أو رمز المنتج"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="ابحث..."
          />

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
            <input
              type="checkbox"
              checked={showZeroStock}
              onChange={(event) => setShowZeroStock(event.target.checked)}
              className="h-4 w-4"
            />
            إظهار الأصناف بدون مخزون
          </label>

          <Select
            value={sort}
            onChange={(event) => setSort(event.target.value as SortOption)}
            className="w-auto"
            aria-label="الترتيب"
          >
            <option value="name">الاسم</option>
            <option value="highest">الأعلى مخزوناً</option>
            <option value="lowest">الأقل مخزوناً</option>
          </Select>
        </div>
      </div>

      {visibleProducts.length === 0 ? (
        <p className="py-12 text-center text-sm text-neutral-bg/50">لا توجد منتجات مطابقة</p>
      ) : (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6">
          {visibleProducts.map(({ product, scopeTotal }) => {
            const lowStock = scopeTotal > 0 && scopeTotal < LOW_STOCK_THRESHOLD;
            return (
              <button
                key={product.id}
                type="button"
                onClick={() => setDetailProduct(product)}
                className="flex flex-col overflow-hidden rounded-card border border-navy-soft bg-navy-deep text-start transition-colors hover:border-gold-champagne/40"
              >
                <div className="relative aspect-square w-full overflow-hidden bg-navy-soft">
                  {product.thumbnailUrl ? (
                    <ProductThumbnail
                      url={product.thumbnailUrl}
                      alt={product.thumbnailAlt ?? product.nameAr ?? product.name}
                      className="h-full w-full object-cover"
                    />
                  ) : (
                    <ProductImagePlaceholder className="h-full w-full" />
                  )}
                  <span
                    className={`absolute end-1.5 top-1.5 inline-flex min-w-7 items-center justify-center rounded-full px-1.5 py-0.5 text-xs font-semibold shadow-card ${
                      scopeTotal === 0 ? "bg-navy-soft text-neutral-bg/60" : lowStock ? "bg-amber-500 text-white" : "bg-chrome text-white"
                    }`}
                  >
                    {scopeTotal}
                  </span>
                </div>
                <div className="flex flex-1 flex-col gap-0.5 p-2.5">
                  <p className="line-clamp-2 text-xs font-medium text-neutral-bg">{product.nameAr ?? product.name}</p>
                  <p className="text-[11px] text-neutral-bg/50">{product.sku}</p>
                  <p className="mt-auto text-[11px] text-neutral-bg/70">المتوفر: {scopeTotal} قطعة</p>
                  {!product.isActive && (
                    <Badge variant="neutral" className="self-start">
                      غير نشط
                    </Badge>
                  )}
                </div>
              </button>
            );
          })}
        </div>
      )}

      {detailProduct && (
        <ProductInventoryDetailModal
          product={detailProduct}
          onClose={() => setDetailProduct(null)}
          scope={scope}
          scopeLocationIds={scopeLocationIds}
          repName={selectedRepLocation?.repName ?? null}
          warehouseLocations={warehouseLocations}
          repCarLocations={repCarLocations}
        />
      )}
    </div>
  );
}

interface ProductInventoryDetailModalProps {
  product: InventoryOverviewProduct;
  onClose: () => void;
  scope: Scope;
  scopeLocationIds: string[];
  repName: string | null;
  warehouseLocations: InventoryOverviewLocation[];
  repCarLocations: InventoryOverviewLocation[];
}

function ProductInventoryDetailModal({
  product,
  onClose,
  scope,
  scopeLocationIds,
  repName,
  warehouseLocations,
  repCarLocations,
}: ProductInventoryDetailModalProps) {
  // "current" mirrors the page's top-level scope; "all" always shows the
  // complete breakdown regardless of scope. COMPANY scope IS already the
  // complete breakdown, so there's nothing to toggle in that case.
  const [tab, setTab] = useState<"current" | "all">(scope === "COMPANY" ? "all" : "current");

  const activeLocationIds = tab === "current" ? scopeLocationIds : null;
  const currentScopeTotal = sumRecord(product.byLocation, scopeLocationIds);
  const warehouseTotal = sumRecord(product.byLocation, warehouseLocations.map((l) => l.id));
  const repCarsTotal = sumRecord(product.byLocation, repCarLocations.map((l) => l.id));
  const companyTotal = warehouseTotal + repCarsTotal;

  const brandGroups = useMemo(() => groupDimensions(product.dimensionGroups), [product.dimensionGroups]);
  const allLocations = useMemo(() => [...warehouseLocations, ...repCarLocations], [warehouseLocations, repCarLocations]);
  const locationsById = useMemo(() => new Map(allLocations.map((location) => [location.id, location])), [allLocations]);
  const visibleLocations = tab === "current"
    ? scopeLocationIds.map((id) => locationsById.get(id)).filter((l): l is InventoryOverviewLocation => Boolean(l))
    : allLocations;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        className="relative flex max-h-[85vh] w-full max-w-lg flex-col overflow-hidden rounded-card border border-navy-soft bg-navy-surface shadow-card"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-start gap-3 border-b border-navy-soft p-4">
          <div className="h-14 w-14 shrink-0 overflow-hidden rounded-card bg-navy-deep">
            {product.thumbnailUrl ? (
              <ProductThumbnail url={product.thumbnailUrl} alt={product.thumbnailAlt ?? product.nameAr ?? product.name} className="h-full w-full object-cover" />
            ) : (
              <ProductImagePlaceholder className="h-full w-full" />
            )}
          </div>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-semibold text-neutral-bg">{product.nameAr ?? product.name}</p>
            <p className="text-xs text-neutral-bg/50">{product.sku}</p>
            {!product.isActive && (
              <Badge variant="neutral" className="mt-1">
                غير نشط
              </Badge>
            )}
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="إغلاق"
            className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-neutral-bg/60 transition-colors hover:bg-navy-deep hover:text-neutral-bg"
          >
            ✕
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-4">
          {scope !== "COMPANY" && (
            <div className="mb-4 flex items-center justify-between rounded-card border border-gold-champagne/30 bg-gold-champagne/10 px-3 py-2">
              <span className="text-sm text-gold-dark">{scopeLabel(scope, repName)}</span>
              <span className="text-base font-bold text-gold-dark">{currentScopeTotal}</span>
            </div>
          )}

          {scope !== "COMPANY" && (
            <div className="mb-4 flex gap-2">
              <button
                type="button"
                onClick={() => setTab("current")}
                className={`rounded-full border px-3 py-1 text-xs font-medium transition-colors ${
                  tab === "current" ? "border-gold-champagne/60 bg-gold-champagne/10 text-gold-champagne" : "border-navy-soft text-neutral-bg/70"
                }`}
              >
                {scopeLabel(scope, repName)}
              </button>
              <button
                type="button"
                onClick={() => setTab("all")}
                className={`rounded-full border px-3 py-1 text-xs font-medium transition-colors ${
                  tab === "all" ? "border-gold-champagne/60 bg-gold-champagne/10 text-gold-champagne" : "border-navy-soft text-neutral-bg/70"
                }`}
              >
                كل المواقع
              </button>
            </div>
          )}

          {tab === "all" && (
            <div className="mb-4 flex flex-col gap-1.5 rounded-card border border-navy-soft bg-navy-deep p-3 text-sm">
              <div className="flex items-center justify-between">
                <span className="text-neutral-bg/70">المخزن</span>
                <span className="text-neutral-bg">{warehouseTotal}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-neutral-bg/70">سيارات المندوبين</span>
                <span className="text-neutral-bg">{repCarsTotal}</span>
              </div>
              <div className="flex items-center justify-between border-t border-navy-soft pt-1.5 text-base font-semibold">
                <span className="text-neutral-bg">إجمالي الشركة</span>
                <span className="text-gold-champagne">{companyTotal}</span>
              </div>
            </div>
          )}

          {tab === "all" && repCarLocations.length > 0 && (
            <div className="mb-4">
              <p className="mb-2 text-xs font-medium text-neutral-bg/60">حسب سيارة المندوب</p>
              <div className="flex flex-col divide-y divide-navy-soft rounded-card border border-navy-soft">
                {[...repCarLocations]
                  .sort((a, b) => (product.byLocation[b.id] ?? 0) - (product.byLocation[a.id] ?? 0))
                  .map((location) => (
                    <div key={location.id} className="flex items-center justify-between px-3 py-2 text-sm">
                      <span className="text-neutral-bg/80">
                        {location.repName ? `سيارة ${location.repName}` : location.name}
                        {location.repIsActive === false ? " (غير نشط)" : ""}
                      </span>
                      <span className="text-neutral-bg">{product.byLocation[location.id] ?? 0}</span>
                    </div>
                  ))}
              </div>
            </div>
          )}

          {product.displayMode === "TOTAL_STOCK" ? (
            <div>
              <p className="mb-2 text-xs font-medium text-neutral-bg/60">حسب الموقع</p>
              <div className="flex flex-col divide-y divide-navy-soft rounded-card border border-navy-soft">
                {visibleLocations.map((location) => (
                  <div key={location.id} className="flex items-center justify-between px-3 py-2 text-sm">
                    <span className="text-neutral-bg/80">{location.type === "WAREHOUSE" ? location.name : location.repName ? `سيارة ${location.repName}` : location.name}</span>
                    <span className="text-neutral-bg">{product.byLocation[location.id] ?? 0}</span>
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <div className="flex flex-col gap-4">
              <p className="text-xs font-medium text-neutral-bg/60">
                {product.displayMode === "DEVICE_MODEL_COLOR" ? "حسب الماركة والموديل واللون" : "حسب الماركة والموديل"}
              </p>
              {brandGroups.map((brand) => {
                const brandTotal = brand.models.reduce((sum, model) => sum + model.items.reduce((s, item) => s + sumRecord(item.byLocation, activeLocationIds), 0), 0);
                return (
                  <div key={brand.brandId || "unclassified"} className="rounded-card border border-navy-soft">
                    <div className="flex items-center justify-between border-b border-navy-soft bg-navy-deep px-3 py-2">
                      <span className="text-sm font-semibold text-neutral-bg">{brand.brandLabel}</span>
                      <span className="text-sm font-semibold text-gold-champagne">{brandTotal}</span>
                    </div>
                    <div className="flex flex-col divide-y divide-navy-soft">
                      {brand.models.map((model) => {
                        const modelTotal = model.items.reduce((sum, item) => sum + sumRecord(item.byLocation, activeLocationIds), 0);
                        const isSingleUncolored = model.items.length === 1 && model.items[0]!.colorId === null;
                        return (
                          <div key={model.modelId} className="px-3 py-2">
                            <div className="flex items-center justify-between">
                              <span className="text-sm text-neutral-bg">{model.modelLabel}</span>
                              <span className="text-sm font-medium text-neutral-bg">{modelTotal}</span>
                            </div>
                            {!isSingleUncolored && (
                              <div className="mt-1.5 flex flex-col gap-1 ps-3">
                                {model.items.map((item) => (
                                  <div key={item.key} className="flex items-center justify-between text-xs">
                                    <span className="flex items-center gap-1.5 text-neutral-bg/70">
                                      {item.colorHex && (
                                        <span aria-hidden="true" className="h-2.5 w-2.5 shrink-0 rounded-full border border-navy-soft" style={{ backgroundColor: item.colorHex }} />
                                      )}
                                      {item.colorLabel ?? "بدون لون"}
                                    </span>
                                    <span className="text-neutral-bg/80">{sumRecord(item.byLocation, activeLocationIds)}</span>
                                  </div>
                                ))}
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {product.total === 0 && (
            <div className="mt-4">
              <Badge variant="neutral">لا يوجد مخزون لهذا المنتج حالياً</Badge>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
