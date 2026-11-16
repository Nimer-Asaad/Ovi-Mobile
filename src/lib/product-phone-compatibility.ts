import "server-only";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { MAX_COMPATIBILITY_PRODUCTS, MAX_COMPATIBILITY_MODELS } from "@/lib/compatibility-limits";

/** Browse-by-device compatibility — "this accessory fits this phone model".
 *
 * METADATA ONLY. Every function here reads/writes ONLY the
 * ProductPhoneCompatibility table (and reads Product / PhoneModel ids to
 * validate). It never touches Product.variantMode / variantAllocationStatus /
 * inventoryTrackingMode, ProductVariant, DeviceColorVariant, InventoryItem,
 * StockMovement, sales, transfers or REP_CAR stock — a product keeps ONE
 * aggregate balance however many models it fits. See the model's doc comment
 * in prisma/schema.prisma.
 *
 * Authorization is the CALLER's job (the server actions are ADMIN-only, like
 * the rest of product management). Compatibility is only ever created by an
 * explicit admin choice — never inferred from product names. */

export { MAX_COMPATIBILITY_PRODUCTS, MAX_COMPATIBILITY_MODELS };

export type CompatibilityChangeResult = { ok: true; changed: number } | { ok: false; error: string };

function cleanIds(ids: readonly string[]): string[] {
  return [...new Set(ids.map((id) => id.trim()).filter(Boolean))];
}

function validateSelection(productIds: string[], phoneModelIds: string[]): string | null {
  if (productIds.length === 0) return "اختر منتجاً واحداً على الأقل";
  if (phoneModelIds.length === 0) return "اختر موديلاً واحداً على الأقل";
  if (productIds.length > MAX_COMPATIBILITY_PRODUCTS) return `الحد الأقصى ${MAX_COMPATIBILITY_PRODUCTS} منتج في العملية الواحدة`;
  if (phoneModelIds.length > MAX_COMPATIBILITY_MODELS) return `الحد الأقصى ${MAX_COMPATIBILITY_MODELS} موديل في العملية الواحدة`;
  return null;
}

/** Links every given product to every given phone model. Idempotent: pairs
 * that already exist are skipped (never duplicated, never an error), and the
 * returned `changed` counts only the rows actually created. Products must
 * exist; models must exist and be active under an active brand (the same list
 * the pickers offer). All-or-nothing: one invalid id rejects the whole call. */
export async function addProductCompatibility(input: { productIds: readonly string[]; phoneModelIds: readonly string[] }): Promise<CompatibilityChangeResult> {
  const productIds = cleanIds(input.productIds);
  const phoneModelIds = cleanIds(input.phoneModelIds);
  const invalid = validateSelection(productIds, phoneModelIds);
  if (invalid) return { ok: false, error: invalid };

  const [products, models] = await Promise.all([
    prisma.product.count({ where: { id: { in: productIds } } }),
    prisma.phoneModel.count({ where: { id: { in: phoneModelIds }, isActive: true, phoneBrand: { isActive: true } } }),
  ]);
  if (products !== productIds.length) return { ok: false, error: "أحد المنتجات غير موجود" };
  if (models !== phoneModelIds.length) return { ok: false, error: "أحد الموديلات غير موجود أو غير فعّال" };

  const created = await prisma.productPhoneCompatibility.createMany({
    data: productIds.flatMap((productId) => phoneModelIds.map((phoneModelId) => ({ productId, phoneModelId }))),
    skipDuplicates: true,
  });
  return { ok: true, changed: created.count };
}

/** Unlinks the given products from the given models. Removing a pair that
 * does not exist is a no-op (`changed` counts only rows actually deleted). */
export async function removeProductCompatibility(input: { productIds: readonly string[]; phoneModelIds: readonly string[] }): Promise<CompatibilityChangeResult> {
  const productIds = cleanIds(input.productIds);
  const phoneModelIds = cleanIds(input.phoneModelIds);
  const invalid = validateSelection(productIds, phoneModelIds);
  if (invalid) return { ok: false, error: invalid };

  const removed = await prisma.productPhoneCompatibility.deleteMany({ where: { productId: { in: productIds }, phoneModelId: { in: phoneModelIds } } });
  return { ok: true, changed: removed.count };
}

export interface CompatibilityModelOption {
  id: string;
  label: string;
}

export interface CompatibilityBrandOption {
  id: string;
  label: string;
  models: CompatibilityModelOption[];
}

/** The picker data: ACTIVE brands → ACTIVE models, in the same sortOrder-then-
 * name order every other brand/model picker in the admin uses. One query. */
export async function getCompatibilityBrandOptions(): Promise<CompatibilityBrandOption[]> {
  const brands = await prisma.phoneBrand.findMany({
    where: { isActive: true },
    orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
    select: {
      id: true,
      name: true,
      nameAr: true,
      models: { where: { isActive: true }, orderBy: [{ sortOrder: "asc" }, { name: "asc" }], select: { id: true, name: true, nameAr: true } },
    },
  });
  return brands
    .filter((brand) => brand.models.length > 0)
    .map((brand) => ({ id: brand.id, label: brand.nameAr ?? brand.name, models: brand.models.map((model) => ({ id: model.id, label: model.nameAr ?? model.name })) }));
}

/** True when a Prisma error means "the compatibility table is not in this
 * database (yet)" — P2021 table missing / P2022 column missing. Used ONLY by
 * the two read helpers below so that code deployed before
 * `prisma migrate deploy` degrades to "no mappings" instead of breaking the
 * pages that merely ALSO show compatibility (the inventory overview, the
 * product edit page). Every other error still propagates. */
export function isMissingCompatibilityTableError(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && (error.code === "P2021" || error.code === "P2022");
}

/** productId → compatible PhoneModel ids, for the inventory overview. One
 * ISOLATED query (the overview's own queries are untouched); with the table
 * missing it returns an empty map, so the overview behaves exactly as it did
 * before the feature. */
export async function getCompatibleModelIdsByProduct(): Promise<Map<string, string[]>> {
  try {
    const rows = await prisma.productPhoneCompatibility.findMany({ select: { productId: true, phoneModelId: true } });
    const byProduct = new Map<string, string[]>();
    for (const row of rows) byProduct.set(row.productId, [...(byProduct.get(row.productId) ?? []), row.phoneModelId]);
    return byProduct;
  } catch (error) {
    if (isMissingCompatibilityTableError(error)) return new Map();
    throw error;
  }
}

export interface LinkedCompatibilityModelRow {
  modelId: string;
  modelLabel: string;
  brandLabel: string;
}

/** The models one product is linked to, for its edit page. Returns null when
 * the compatibility table does not exist yet (the page then simply hides the
 * section and the rest of the edit page is unaffected). */
export async function getProductCompatibilityLinks(productId: string): Promise<LinkedCompatibilityModelRow[] | null> {
  try {
    const rows = await prisma.productPhoneCompatibility.findMany({
      where: { productId },
      select: { phoneModel: { select: { id: true, name: true, nameAr: true, phoneBrand: { select: { name: true, nameAr: true } } } } },
    });
    return rows
      .map((row) => ({ modelId: row.phoneModel.id, modelLabel: row.phoneModel.nameAr ?? row.phoneModel.name, brandLabel: row.phoneModel.phoneBrand.nameAr ?? row.phoneModel.phoneBrand.name }))
      .sort((a, b) => a.brandLabel.localeCompare(b.brandLabel) || a.modelLabel.localeCompare(b.modelLabel, "en", { numeric: true }));
  } catch (error) {
    if (isMissingCompatibilityTableError(error)) return null;
    throw error;
  }
}
