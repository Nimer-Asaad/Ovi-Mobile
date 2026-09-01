"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/auth/guards";
import { ROLES, STOCK_LOCATION_TYPES } from "@/lib/constants";
import {
  buildProductPurgePreview,
  purgeProductsInTransaction,
  PURGE_CONFIRMATION_PHRASE,
  type ProductPurgePreview,
  type ProductPurgeResult,
} from "@/lib/product-purge";
import { productPurgeIdsSchema, productPurgeConfirmSchema } from "@/lib/validation/productPurge";

const PURGE_PAGE_SIZE = 30;

export interface ProductPurgeSearchRow {
  id: string;
  sku: string;
  name: string;
  nameAr: string | null;
  isActive: boolean;
  thumbnailUrl: string | null;
  thumbnailAlt: string | null;
  categoryLabel: string | null;
  warehouseStock: number;
  repStock: number;
  companyTotal: number;
}

export interface ProductPurgeSearchResult {
  rows: ProductPurgeSearchRow[];
  totalCount: number;
  page: number;
  pageSize: number;
}

/** Read-only, paginated product search for the purge-selection screen —
 * ADMIN only. Never loads the whole catalog: the product query itself is
 * bounded by skip/take (PURGE_PAGE_SIZE), and the two inventory sums are
 * scoped to just this page's product ids (never the full catalog), so cost
 * stays flat no matter how many products exist — 3 bounded queries total,
 * the same shape as getCompanyInventoryReport/company-report search. */
export async function searchProductsForPurge(query: string, categoryId: string | null, page: number): Promise<ProductPurgeSearchResult> {
  await requireRole([ROLES.ADMIN]);

  const trimmed = query.trim();
  const safePage = Number.isSafeInteger(page) && page > 0 ? page : 1;

  const where = {
    ...(categoryId ? { categoryId } : {}),
    ...(trimmed
      ? {
          OR: [
            { name: { contains: trimmed, mode: "insensitive" as const } },
            { nameAr: { contains: trimmed, mode: "insensitive" as const } },
            { sku: { contains: trimmed, mode: "insensitive" as const } },
          ],
        }
      : {}),
  };

  const [total, products] = await Promise.all([
    prisma.product.count({ where }),
    prisma.product.findMany({
      where,
      select: {
        id: true,
        sku: true,
        name: true,
        nameAr: true,
        isActive: true,
        category: { select: { name: true, nameAr: true } },
        images: {
          where: { mediaType: "IMAGE" },
          select: { url: true, altText: true },
          orderBy: [{ isMain: "desc" }, { sortOrder: "asc" }],
          take: 1,
        },
      },
      orderBy: [{ name: "asc" }],
      skip: (safePage - 1) * PURGE_PAGE_SIZE,
      take: PURGE_PAGE_SIZE,
    }),
  ]);

  const productIds = products.map((product) => product.id);
  const [warehouseSums, repSums] =
    productIds.length === 0
      ? [[], []]
      : await Promise.all([
          prisma.inventoryItem.groupBy({
            by: ["productId"],
            where: { productId: { in: productIds }, location: { type: STOCK_LOCATION_TYPES.WAREHOUSE } },
            _sum: { quantity: true },
          }),
          prisma.inventoryItem.groupBy({
            by: ["productId"],
            where: {
              productId: { in: productIds },
              location: { type: STOCK_LOCATION_TYPES.REP_CAR },
              variantId: null,
              deviceColorVariantId: null,
            },
            _sum: { quantity: true },
          }),
        ]);

  const warehouseByProduct = new Map(warehouseSums.map((row) => [row.productId, row._sum.quantity ?? 0]));
  const repByProduct = new Map(repSums.map((row) => [row.productId, row._sum.quantity ?? 0]));

  const rows: ProductPurgeSearchRow[] = products.map((product) => {
    const warehouseStock = warehouseByProduct.get(product.id) ?? 0;
    const repStock = repByProduct.get(product.id) ?? 0;
    return {
      id: product.id,
      sku: product.sku,
      name: product.name,
      nameAr: product.nameAr,
      isActive: product.isActive,
      thumbnailUrl: product.images[0]?.url ?? null,
      thumbnailAlt: product.images[0]?.altText ?? null,
      categoryLabel: product.category?.nameAr ?? product.category?.name ?? null,
      warehouseStock,
      repStock,
      companyTotal: warehouseStock + repStock,
    };
  });

  return { rows, totalCount: total, page: safePage, pageSize: PURGE_PAGE_SIZE };
}

export interface ProductPurgePreviewState {
  ok: boolean;
  error?: string;
  preview?: ProductPurgePreview;
}

/** Read-only preview — ADMIN only, never writes anything. Refetches every
 * row fresh from the DB by id; never trusts a name/SKU/count the client
 * might have cached from an earlier search page. */
export async function getProductPurgePreview(productIdsInput: string[]): Promise<ProductPurgePreviewState> {
  await requireRole([ROLES.ADMIN]);

  const uniqueIds = [...new Set(productIdsInput)];
  const parsed = productPurgeIdsSchema.safeParse({ productIds: uniqueIds });
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "طلب غير صالح" };
  }

  const preview = await buildProductPurgePreview(prisma, parsed.data.productIds);
  if (preview.rows.length !== parsed.data.productIds.length) {
    return { ok: false, error: "أحد المنتجات المحددة لم يعد موجوداً — أعد تحديد المنتجات" };
  }

  return { ok: true, preview };
}

export interface ProductPurgeActionState {
  ok: boolean;
  error?: string;
  result?: ProductPurgeResult;
}

/** THE destructive action. ADMIN only — independently re-checked here, never
 * relying on the page/layout guard alone (see requireRole below). Dedupes,
 * caps, and requires the exact typed confirmation phrase before touching the
 * database at all; refetches and count-matches every product id right
 * before opening the transaction, and again — via the post-delete
 * dependency-count invariant inside purgeProductsInTransaction — right
 * before the transaction is allowed to commit. Any failure at any point
 * (missing product, FK violation, invariant mismatch) throws, which rolls
 * back the WHOLE transaction: either every selected product is purged, or
 * none of them are. */
export async function purgeProductsPermanently(productIdsInput: string[], confirmPhraseInput: string): Promise<ProductPurgeActionState> {
  await requireRole([ROLES.ADMIN]);

  const uniqueIds = [...new Set(productIdsInput)];
  const parsed = productPurgeConfirmSchema.safeParse({ productIds: uniqueIds, confirmPhrase: confirmPhraseInput });
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "طلب غير صالح" };
  }
  if (parsed.data.confirmPhrase !== PURGE_CONFIRMATION_PHRASE) {
    return { ok: false, error: `يجب كتابة "${PURGE_CONFIRMATION_PHRASE}" بالضبط لتأكيد الحذف` };
  }

  const { productIds } = parsed.data;

  // Cheap pre-check before opening the transaction. Re-verified again
  // inside the transaction itself (purgeProductsInTransaction throws if the
  // count doesn't match), covering the unlikely gap between this check and
  // the transaction actually starting.
  const existingCount = await prisma.product.count({ where: { id: { in: productIds } } });
  if (existingCount !== productIds.length) {
    return { ok: false, error: "أحد المنتجات المحددة لم يعد موجوداً — أعد تحديد المنتجات وحاول مجدداً" };
  }

  let result: ProductPurgeResult;
  try {
    result = await prisma.$transaction(async (tx) => purgeProductsInTransaction(tx, productIds), { timeout: 120_000 });
  } catch (err) {
    console.error("Product purge failed — transaction rolled back, nothing was deleted:", err);
    return { ok: false, error: "تعذّر إتمام الحذف النهائي — لم يُحذف أي شيء (تم التراجع الكامل عن العملية)" };
  }

  revalidatePath("/admin/products");
  revalidatePath("/admin/products/purge");
  revalidatePath("/admin/inventory");
  revalidatePath("/admin/inventory/adjust");
  revalidatePath("/admin/inventory/overview");
  revalidatePath("/admin/inventory/company-report");
  revalidatePath("/admin/inventory/movements");
  revalidatePath("/admin");
  revalidatePath("/products");
  revalidatePath("/");
  revalidatePath("/rep/stock");
  revalidatePath("/rep/sales/new");
  revalidatePath("/rep/requests/new");

  return { ok: true, result };
}
