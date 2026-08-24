import "server-only";

/** One WAREHOUSE or REP_CAR stock location, with its owning rep resolved via
 * the real StockLocation.salesRep relation — never parsed from the location
 * name. repId/repName/repIsActive stay null for WAREHOUSE (no rep) and for a
 * REP_CAR location that somehow has no linked SalesRepresentative (shouldn't
 * happen — getOrCreateRepLocation always sets salesRepId — but handled
 * safely rather than crashing the page). */
export interface InventoryOverviewLocation {
  id: string;
  type: "WAREHOUSE" | "REP_CAR";
  name: string;
  repId: string | null;
  repName: string | null;
  repIsActive: boolean | null;
}

/** One brand+model (PHONE_COMPATIBILITY) or brand+model+color
 * (DEVICE_MODEL_COLOR) breakdown row for a single product. colorId/
 * colorLabel/colorHex stay null for a PHONE_COMPATIBILITY group. byLocation
 * is keyed by StockLocation.id; every group for the same product carries the
 * exact same set of location keys as the product's own byLocation, so
 * summing any one location's value across every group always reconciles
 * exactly against the product total for that location. */
export interface InventoryOverviewDimensionGroup {
  key: string;
  brandId: string;
  brandLabel: string;
  modelId: string;
  modelLabel: string;
  colorId: string | null;
  colorLabel: string | null;
  colorHex: string | null;
  byLocation: Record<string, number>;
  total: number;
  /** True only for the synthetic catch-all group used to surface inventory
   * that exists under a variant/combo id no longer in the product's active
   * variant/combo list (e.g. a retired option) — kept visible instead of
   * silently dropped from the reconciled total. Practically rare. */
  isUnclassified?: boolean;
}

export type InventoryOverviewDisplayMode = "TOTAL_STOCK" | "PHONE_COMPATIBILITY" | "DEVICE_MODEL_COLOR";

export interface InventoryOverviewProduct {
  id: string;
  sku: string;
  name: string;
  nameAr: string | null;
  thumbnailUrl: string | null;
  thumbnailAlt: string | null;
  categoryId: string | null;
  categoryLabel: string | null;
  /** This is a physical stock-control screen, not the sale-facing catalog —
   * an inactive/discontinued product with real InventoryItem rows still
   * needs to be visible to ADMIN/ADMIN_ASSISTANT (see the product query in
   * overview/page.tsx, which no longer filters isActive). Surfaced here so
   * the UI can badge it "غير نشط" rather than hide it outright; the existing
   * zero-stock toggle already keeps an inactive+zero-stock product hidden
   * by default with no extra logic needed. */
  isActive: boolean;
  displayMode: InventoryOverviewDisplayMode;
  /** Total quantity per location, summed across every dimension — the
   * single source of truth for this product's stock. Always computed
   * directly from every raw InventoryItem row for this product, never
   * derived from dimensionGroups (see the unclassified-group handling
   * below for why: it must reconcile even for an edge case dimensionGroups
   * can't fully classify). */
  byLocation: Record<string, number>;
  /** Sum of byLocation — this product's total across every passed-in
   * location (callers decide which locations to pass in for "company
   * total" vs a narrower scope by filtering byLocation themselves). */
  total: number;
  /** Empty for TOTAL_STOCK — the flat byLocation breakdown is the whole
   * story for that mode. Populated for PHONE_COMPATIBILITY/
   * DEVICE_MODEL_COLOR. */
  dimensionGroups: InventoryOverviewDimensionGroup[];
}

export interface InventoryOverviewData {
  locations: InventoryOverviewLocation[];
  products: InventoryOverviewProduct[];
}

interface RawProduct {
  id: string;
  sku: string;
  name: string;
  nameAr: string | null;
  isActive: boolean;
  categoryId: string | null;
  category: { name: string; nameAr: string | null } | null;
  images: { url: string; altText: string | null }[];
  variantMode: string;
  inventoryTrackingMode: string;
  variants: {
    id: string;
    phoneModel: {
      id: string;
      name: string;
      nameAr: string | null;
      phoneBrandId: string;
      phoneBrand: { id: string; name: string; nameAr: string | null };
    };
  }[];
  deviceColorVariants: {
    id: string;
    phoneModel: {
      id: string;
      name: string;
      nameAr: string | null;
      phoneBrandId: string;
      phoneBrand: { id: string; name: string; nameAr: string | null };
    };
    color: { id: string; name: string; nameAr: string | null; hexCode: string | null };
  }[];
}

interface RawInventoryItem {
  productId: string;
  locationId: string;
  variantId: string | null;
  deviceColorVariantId: string | null;
  quantity: number;
}

/** Builds the one normalized, fully server-computed inventory dataset the
 * overview page's client component reads from — every number here already
 * comes straight from InventoryItem.quantity (never StockMovement, never a
 * cached/derived total), so the client only ever selects/sums pre-computed
 * per-location figures, it never recomputes stock itself. Runs in three
 * bounded passes over the already-fetched rows (no per-product or
 * per-variant queries) — see the overview page.tsx for the exact Prisma
 * query set this consumes. */
export function buildInventoryOverviewData(
  rawProducts: RawProduct[],
  rawInventoryItems: RawInventoryItem[],
): InventoryOverviewProduct[] {
  // productId -> key -> locationId -> quantity. Keys are explicitly prefixed
  // (VARIANT:/DEVICE_COLOR:/TOTAL) purely for audit clarity — variantId and
  // deviceColorVariantId are already mutually exclusive per row (DB CHECK
  // constraint) and per product (a product uses at most one of the two
  // systems), so there's no real collision risk being guarded against here.
  const rowsByProduct = new Map<string, Map<string, Map<string, number>>>();
  for (const item of rawInventoryItems) {
    if (item.quantity <= 0) continue;
    const key = item.variantId ? `VARIANT:${item.variantId}` : item.deviceColorVariantId ? `DEVICE_COLOR:${item.deviceColorVariantId}` : "TOTAL";
    let byKey = rowsByProduct.get(item.productId);
    if (!byKey) {
      byKey = new Map();
      rowsByProduct.set(item.productId, byKey);
    }
    let byLocation = byKey.get(key);
    if (!byLocation) {
      byLocation = new Map();
      byKey.set(key, byLocation);
    }
    byLocation.set(item.locationId, (byLocation.get(item.locationId) ?? 0) + item.quantity);
  }

  return rawProducts.map((product): InventoryOverviewProduct => {
    const byKey = rowsByProduct.get(product.id) ?? new Map<string, Map<string, number>>();

    // byLocation is always the direct sum of every raw row for this
    // product, regardless of key — authoritative independent of whichever
    // dimension groups get built below.
    const byLocation: Record<string, number> = {};
    for (const [, locMap] of byKey) {
      for (const [locationId, quantity] of locMap) {
        byLocation[locationId] = (byLocation[locationId] ?? 0) + quantity;
      }
    }
    const total = Object.values(byLocation).reduce((sum, q) => sum + q, 0);

    const isDeviceModelColor = product.inventoryTrackingMode === "DEVICE_MODEL_COLOR";
    // Deliberately NOT gated on variantAllocationStatus === "READY" — that
    // status only controls whether a variant can be picked for a NEW
    // transaction (assign-stock/manual-order); it says nothing about
    // whether physical InventoryItem rows already exist under a variantId.
    // This is a read-only physical-stock screen, not a selling flow, so a
    // still-PENDING product's real stock must stay visible and correctly
    // attributed to its brand/model rather than being hidden or dumped
    // into an undifferentiated flat total.
    const isPhoneCompatibility = product.variantMode === "PHONE_COMPATIBILITY";
    const displayMode: InventoryOverviewDisplayMode = isDeviceModelColor
      ? "DEVICE_MODEL_COLOR"
      : isPhoneCompatibility
        ? "PHONE_COMPATIBILITY"
        : "TOTAL_STOCK";

    const dimensionGroups: InventoryOverviewDimensionGroup[] = [];
    const claimedKeys = new Set<string>();

    if (isDeviceModelColor) {
      for (const combo of product.deviceColorVariants) {
        const comboKey = `DEVICE_COLOR:${combo.id}`;
        const locMap = byKey.get(comboKey);
        claimedKeys.add(comboKey);
        const groupByLocation: Record<string, number> = {};
        let groupTotal = 0;
        if (locMap) {
          for (const [locationId, quantity] of locMap) {
            groupByLocation[locationId] = quantity;
            groupTotal += quantity;
          }
        }
        dimensionGroups.push({
          key: combo.id,
          brandId: combo.phoneModel.phoneBrandId,
          brandLabel: combo.phoneModel.phoneBrand.nameAr ?? combo.phoneModel.phoneBrand.name,
          modelId: combo.phoneModel.id,
          modelLabel: combo.phoneModel.nameAr ?? combo.phoneModel.name,
          colorId: combo.color.id,
          colorLabel: combo.color.nameAr ?? combo.color.name,
          colorHex: combo.color.hexCode,
          byLocation: groupByLocation,
          total: groupTotal,
        });
      }
    } else if (isPhoneCompatibility) {
      for (const variant of product.variants) {
        const variantKey = `VARIANT:${variant.id}`;
        const locMap = byKey.get(variantKey);
        claimedKeys.add(variantKey);
        const groupByLocation: Record<string, number> = {};
        let groupTotal = 0;
        if (locMap) {
          for (const [locationId, quantity] of locMap) {
            groupByLocation[locationId] = quantity;
            groupTotal += quantity;
          }
        }
        dimensionGroups.push({
          key: variant.id,
          brandId: variant.phoneModel.phoneBrandId,
          brandLabel: variant.phoneModel.phoneBrand.nameAr ?? variant.phoneModel.phoneBrand.name,
          modelId: variant.phoneModel.id,
          modelLabel: variant.phoneModel.nameAr ?? variant.phoneModel.name,
          colorId: null,
          colorLabel: null,
          colorHex: null,
          byLocation: groupByLocation,
          total: groupTotal,
        });
      }
    }

    // Any row whose key isn't one of this product's currently active
    // variants/combos (a retired option, or legacy/pending-allocation
    // inventory still sitting in the flat TOTAL bucket despite the product
    // now being a dimensional product) would otherwise vanish from the
    // dimension breakdown while still counting in byLocation/total —
    // surface it instead of losing it, so dimensionGroups always sums to
    // exactly byLocation. Gated on displayMode (not dimensionGroups.length)
    // so this still runs even when a PHONE_COMPATIBILITY product has zero
    // ProductVariant rows yet but already has legacy flat stock.
    if (displayMode !== "TOTAL_STOCK") {
      const unclassifiedByLocation: Record<string, number> = {};
      let unclassifiedTotal = 0;
      for (const [key, locMap] of byKey) {
        if (claimedKeys.has(key)) continue;
        for (const [locationId, quantity] of locMap) {
          unclassifiedByLocation[locationId] = (unclassifiedByLocation[locationId] ?? 0) + quantity;
          unclassifiedTotal += quantity;
        }
      }
      if (unclassifiedTotal > 0) {
        dimensionGroups.push({
          key: "UNCLASSIFIED",
          brandId: "",
          brandLabel: "غير مصنّف",
          modelId: "",
          modelLabel: "غير مصنّف",
          colorId: null,
          colorLabel: null,
          colorHex: null,
          byLocation: unclassifiedByLocation,
          total: unclassifiedTotal,
          isUnclassified: true,
        });
      }
    }

    return {
      id: product.id,
      sku: product.sku,
      name: product.name,
      nameAr: product.nameAr,
      isActive: product.isActive,
      thumbnailUrl: product.images[0]?.url ?? null,
      thumbnailAlt: product.images[0]?.altText ?? null,
      categoryId: product.categoryId,
      categoryLabel: product.category?.nameAr ?? product.category?.name ?? null,
      displayMode,
      byLocation,
      total,
      dimensionGroups,
    };
  });
}
