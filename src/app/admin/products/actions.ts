"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/auth/guards";
import { PRODUCT_INVENTORY_TRACKING_MODES, PRODUCT_VARIANT_MODES, ROLES, VARIANT_ALLOCATION_STATUSES } from "@/lib/constants";
import { productSchema } from "@/lib/validation/catalog";
import { validateMediaBuffer, inferMediaTypeFromUrl, type MediaType } from "@/lib/validation/productMedia";
import { deleteUnreferencedUploadedProductFiles, saveUploadedProductFile } from "@/lib/uploads";
import { productRemovalSchema } from "@/lib/validation/productRemoval";
import { changeInventoryTrackingMode, InventoryTrackingModeConversionError } from "@/lib/inventory-tracking";
import type { ProductInventoryTrackingMode } from "@/types";
import type { z } from "zod";

export interface ProductFormState {
  error?: string;
  fieldErrors?: Record<string, string>;
}

export interface TrackingModeState {
  error?: string;
  success?: string;
}

export type ProductRemovalResult =
  | { ok: true; mode: "archived" | "deleted"; message: string }
  | { ok: false; message: string };

const DUPLICATE_SKU_MESSAGE = "رمز المنتج (SKU) مستخدم بالفعل";
const DUPLICATE_MEDIA_MESSAGE = "لا يمكن استخدام نفس رابط الوسائط أكثر من مرة";
const INVALID_MEDIA_URL_MESSAGE = "روابط الوسائط يجب أن تبدأ بـ http:// أو https://";

function parseProductForm(formData: FormData) {
  return productSchema.safeParse({
    name: formData.get("name")?.toString().trim() ?? "",
    nameAr: formData.get("nameAr")?.toString().trim() || undefined,
    description: formData.get("description")?.toString().trim() || undefined,
    sku: formData.get("sku")?.toString().trim() ?? "",
    categoryId: formData.get("categoryId")?.toString() ?? "",
    brandId: formData.get("brandId")?.toString() ?? "",
    supplierId: formData.get("supplierId")?.toString() || undefined,
    retailPriceCents: formData.get("retailPriceCents")?.toString() ?? "",
    wholesalePriceCents: formData.get("wholesalePriceCents")?.toString() ?? "",
    costCents: formData.get("costCents")?.toString() || undefined,
  });
}

function fieldErrorsFrom(error: z.ZodError) {
  const fieldErrors: Record<string, string> = {};
  for (const issue of error.issues) {
    const key = issue.path[0];
    if (typeof key === "string" && !fieldErrors[key]) fieldErrors[key] = issue.message;
  }
  return fieldErrors;
}

interface MediaEntry {
  url: string;
  mediaType: MediaType;
  cloudinaryPublicId: string | null;
}

type CollectMediaResult =
  | { ok: true; entries: { url: string; mediaType: MediaType; cloudinaryPublicId: string | null; isMain: boolean }[] }
  | { ok: false; error: string };

/**
 * Reads the dynamic media_<i>_* fields written by ProductMediaUploader.
 * Every entry is re-validated server-side (MIME/size for uploads, http(s)
 * prefix for pasted URLs) — the client's disabled/hidden inputs are only a
 * UX hint, never trusted alone. The requested main slot (mainMediaIndex) is
 * only honored if it resolves to an IMAGE; otherwise this falls back to the
 * first IMAGE entry, or no main at all, so a video can never become main
 * regardless of what the client submitted.
 */
async function collectProductMedia(formData: FormData): Promise<CollectMediaResult> {
  const count = Math.max(0, Math.min(50, parseInt(formData.get("mediaCount")?.toString() ?? "0", 10) || 0));
  const requestedMainIndex = parseInt(formData.get("mainMediaIndex")?.toString() ?? "-1", 10);

  const slotEntries: (MediaEntry | null)[] = [];

  for (let i = 0; i < count; i++) {
    const kind = formData.get(`media_${i}_kind`)?.toString();

    if (kind === "existing") {
      const url = formData.get(`media_${i}_url`)?.toString();
      const mediaType = formData.get(`media_${i}_mediaType`)?.toString();
      const cloudinaryPublicId = formData.get(`media_${i}_cloudinaryPublicId`)?.toString() || null;
      if (url && (mediaType === "IMAGE" || mediaType === "VIDEO")) {
        slotEntries.push({ url, mediaType, cloudinaryPublicId });
      } else {
        slotEntries.push(null);
      }
      continue;
    }

    if (kind === "new") {
      const file = formData.get(`media_${i}_file`);
      if (file instanceof File && file.size > 0) {
        const buffer = Buffer.from(await file.arrayBuffer());
        const validation = validateMediaBuffer(buffer);
        if (!validation.ok) {
          return { ok: false, error: validation.error };
        }
        const saved = await saveUploadedProductFile(buffer, validation);
        if (!saved.ok) {
          return { ok: false, error: saved.error };
        }
        slotEntries.push({ url: saved.url, mediaType: validation.mediaType, cloudinaryPublicId: saved.cloudinaryPublicId });
        continue;
      }

      const url = formData.get(`media_${i}_url`)?.toString().trim();
      if (url) {
        if (!/^https?:\/\//.test(url)) {
          return { ok: false, error: INVALID_MEDIA_URL_MESSAGE };
        }
        slotEntries.push({ url, mediaType: inferMediaTypeFromUrl(url), cloudinaryPublicId: null });
      } else {
        slotEntries.push(null);
      }
      continue;
    }

    slotEntries.push(null);
  }

  const entries = slotEntries.filter((entry): entry is MediaEntry => entry !== null);

  if (new Set(entries.map((entry) => entry.url)).size !== entries.length) {
    return { ok: false, error: DUPLICATE_MEDIA_MESSAGE };
  }

  const requestedMain =
    requestedMainIndex >= 0 && requestedMainIndex < slotEntries.length ? slotEntries[requestedMainIndex] : null;
  const mainEntry = requestedMain?.mediaType === "IMAGE" ? requestedMain : (entries.find((e) => e.mediaType === "IMAGE") ?? null);

  const ordered = mainEntry ? [mainEntry, ...entries.filter((entry) => entry !== mainEntry)] : entries;

  return {
    ok: true,
    entries: ordered.map((entry, index) => ({ ...entry, isMain: mainEntry !== null && index === 0 })),
  };
}

function collectColorIds(formData: FormData): string[] {
  return formData.getAll("colorIds").map((value) => value.toString());
}

/** Delete-then-recreate the product's offered-colors list. Safe regardless
 * of existing inventory/order history: InventoryItem/OrderItem/
 * StockMovement/StockRequestItem/StockReturnItem all reference Color
 * directly (not ProductColorOption), so removing a color as a *currently
 * offered* option never touches historical rows — see the Color model doc
 * comment in prisma/schema.prisma. */
async function replaceProductColorOptions(productId: string, colorIds: string[]): Promise<void> {
  const uniqueColorIds = [...new Set(colorIds)];
  await prisma.$transaction([
    prisma.productColorOption.deleteMany({ where: { productId } }),
    ...(uniqueColorIds.length > 0
      ? [
          prisma.productColorOption.createMany({
            data: uniqueColorIds.map((colorId, index) => ({ productId, colorId, sortOrder: index })),
          }),
        ]
      : []),
  ]);
}

async function replaceProductImages(
  productId: string,
  entries: { url: string; mediaType: MediaType; cloudinaryPublicId: string | null; isMain: boolean }[],
  productName: string,
): Promise<void> {
  await prisma.$transaction([
    prisma.productImage.deleteMany({ where: { productId } }),
    ...(entries.length > 0
      ? [
          prisma.productImage.createMany({
            data: entries.map((entry, index) => ({
              productId,
              url: entry.url,
              mediaType: entry.mediaType,
              cloudinaryPublicId: entry.cloudinaryPublicId,
              altText: productName,
              isMain: entry.isMain,
              sortOrder: index,
            })),
          }),
        ]
      : []),
  ]);
}

export async function createProduct(
  _prevState: ProductFormState,
  formData: FormData,
): Promise<ProductFormState> {
  await requireRole([ROLES.ADMIN]);

  const parsed = parseProductForm(formData);
  if (!parsed.success) {
    return { fieldErrors: fieldErrorsFrom(parsed.error) };
  }

  const media = await collectProductMedia(formData);
  if (!media.ok) {
    return { fieldErrors: { media: media.error } };
  }

  const colorIds = collectColorIds(formData);
  if (colorIds.length > 0) {
    const validColorCount = await prisma.color.count({ where: { id: { in: colorIds } } });
    if (validColorCount !== new Set(colorIds).size) {
      return { error: "أحد الألوان المحددة غير موجود" };
    }
  }

  const existingSku = await prisma.product.findUnique({ where: { sku: parsed.data.sku } });
  if (existingSku) {
    return { error: DUPLICATE_SKU_MESSAGE };
  }

  const isFeatured = formData.get("isFeatured") === "on";
  const usesPhoneVariants = formData.get("usesPhoneVariants") === "on";
  const inventoryTrackingMode = formData.get("inventoryTrackingMode")?.toString() === PRODUCT_INVENTORY_TRACKING_MODES.DEVICE_MODEL_COLOR
    ? PRODUCT_INVENTORY_TRACKING_MODES.DEVICE_MODEL_COLOR
    : PRODUCT_INVENTORY_TRACKING_MODES.TOTAL_STOCK;

  if (usesPhoneVariants && inventoryTrackingMode === PRODUCT_INVENTORY_TRACKING_MODES.DEVICE_MODEL_COLOR) {
    return { error: "لا يمكن الجمع بين نظام توافق الهواتف القديم ونظام مخزون الجهاز واللون على نفس المنتج" };
  }

  let productId: string;
  try {
    const product = await prisma.product.create({
      data: {
        name: parsed.data.name,
        nameAr: parsed.data.nameAr,
        description: parsed.data.description,
        sku: parsed.data.sku,
        categoryId: parsed.data.categoryId,
        brandId: parsed.data.brandId,
        supplierId: parsed.data.supplierId,
        retailPriceCents: parsed.data.retailPriceCents,
        wholesalePriceCents: parsed.data.wholesalePriceCents,
        costCents: parsed.data.costCents,
        isFeatured,
        variantMode: usesPhoneVariants ? PRODUCT_VARIANT_MODES.PHONE_COMPATIBILITY : PRODUCT_VARIANT_MODES.NONE,
        variantAllocationStatus: usesPhoneVariants ? VARIANT_ALLOCATION_STATUSES.PENDING : VARIANT_ALLOCATION_STATUSES.NOT_REQUIRED,
        inventoryTrackingMode,
      },
    });
    productId = product.id;
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      return { error: DUPLICATE_SKU_MESSAGE };
    }
    throw err;
  }

  if (media.entries.length > 0) {
    await replaceProductImages(productId, media.entries, parsed.data.name);
  }
  await replaceProductColorOptions(productId, colorIds);

  revalidatePath("/admin/products");
  revalidatePath("/admin");
  revalidatePath("/products");
  if (usesPhoneVariants) redirect(`/admin/products/${productId}/variants`);
  if (inventoryTrackingMode === PRODUCT_INVENTORY_TRACKING_MODES.DEVICE_MODEL_COLOR) redirect(`/admin/products/${productId}/device-inventory`);
  redirect("/admin/products");
}

export async function updateProduct(
  id: string,
  _prevState: ProductFormState,
  formData: FormData,
): Promise<ProductFormState> {
  await requireRole([ROLES.ADMIN]);

  const parsed = parseProductForm(formData);
  if (!parsed.success) {
    return { fieldErrors: fieldErrorsFrom(parsed.error) };
  }

  const media = await collectProductMedia(formData);
  if (!media.ok) {
    return { fieldErrors: { media: media.error } };
  }

  const colorIds = collectColorIds(formData);
  if (colorIds.length > 0) {
    const validColorCount = await prisma.color.count({ where: { id: { in: colorIds } } });
    if (validColorCount !== new Set(colorIds).size) {
      return { error: "أحد الألوان المحددة غير موجود" };
    }
  }

  const existingSku = await prisma.product.findFirst({
    where: { sku: parsed.data.sku, id: { not: id } },
  });
  if (existingSku) {
    return { error: DUPLICATE_SKU_MESSAGE };
  }

  const isFeatured = formData.get("isFeatured") === "on";

  try {
    await prisma.product.update({
      where: { id },
      data: {
        name: parsed.data.name,
        nameAr: parsed.data.nameAr ?? null,
        description: parsed.data.description ?? null,
        sku: parsed.data.sku,
        categoryId: parsed.data.categoryId,
        brandId: parsed.data.brandId,
        supplierId: parsed.data.supplierId ?? null,
        retailPriceCents: parsed.data.retailPriceCents,
        wholesalePriceCents: parsed.data.wholesalePriceCents,
        costCents: parsed.data.costCents ?? null,
        isFeatured,
      },
    });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      return { error: DUPLICATE_SKU_MESSAGE };
    }
    throw err;
  }

  await replaceProductImages(id, media.entries, parsed.data.name);
  await replaceProductColorOptions(id, colorIds);

  revalidatePath("/admin/products");
  revalidatePath("/admin");
  revalidatePath("/products");
  redirect("/admin/products");
}

const TRACKING_MODE_ERROR_MESSAGES: Record<InventoryTrackingModeConversionError["code"], (details?: { quantity?: number; comboCount?: number }) => string> = {
  LEGACY_VARIANT_MODE: () =>
    "هذا المنتج يستخدم نظام توافق الهواتف القديم (Variants)؛ لا يمكن تحويله إلى مخزون الجهاز واللون في هذه المرحلة",
  EXISTING_TOTAL_STOCK: (details) =>
    `لا يمكن التحويل لوجود مخزون إجمالي حالي (${details?.quantity ?? 0} قطعة) — صفّر المخزون من صفحة المخزون أولاً ثم أعد المحاولة، لتفادي فقدان الكمية`,
  EXISTING_COMBOS: (details) =>
    `لا يمكن التحويل لوجود ${details?.comboCount ?? 0} تركيبة (جهاز/لون) مرتبطة بهذا المنتج — احذف أو عطّل كل التركيبات أولاً من صفحة تركيبات المخزون`,
};

/** Guarded, isolated from updateProduct on purpose: converting tracking mode
 * can be refused for data-safety reasons (see changeInventoryTrackingMode),
 * and mixing that with the unrelated name/price/media save would make a
 * partial failure confusing. Redirects into the combo manager only on a
 * successful switch to DEVICE_MODEL_COLOR — every other outcome re-renders
 * the edit page with a clear Arabic message and touches no inventory. */
export async function updateInventoryTrackingMode(
  productId: string,
  _prevState: TrackingModeState,
  formData: FormData,
): Promise<TrackingModeState> {
  await requireRole([ROLES.ADMIN]);

  const raw = formData.get("inventoryTrackingMode")?.toString();
  if (raw !== PRODUCT_INVENTORY_TRACKING_MODES.TOTAL_STOCK && raw !== PRODUCT_INVENTORY_TRACKING_MODES.DEVICE_MODEL_COLOR) {
    return { error: "وضع تتبع المخزون غير صالح" };
  }
  const newMode: ProductInventoryTrackingMode = raw;

  try {
    await prisma.$transaction((tx) => changeInventoryTrackingMode(tx, { productId, newMode }));
  } catch (error) {
    if (error instanceof InventoryTrackingModeConversionError) {
      return { error: TRACKING_MODE_ERROR_MESSAGES[error.code](error.details) };
    }
    throw error;
  }

  revalidatePath(`/admin/products/${productId}/edit`);
  revalidatePath("/admin/products");
  revalidatePath("/admin/inventory");

  if (newMode === PRODUCT_INVENTORY_TRACKING_MODES.DEVICE_MODEL_COLOR) {
    redirect(`/admin/products/${productId}/device-inventory`);
  }
  return { success: "تم تحديث طريقة تتبع المخزون إلى مخزون إجمالي" };
}

export async function toggleProductActive(id: string): Promise<void> {
  await requireRole([ROLES.ADMIN]);

  const product = await prisma.product.findUniqueOrThrow({ where: { id } });
  await prisma.product.update({ where: { id }, data: { isActive: !product.isActive } });

  revalidatePath("/admin/products");
  revalidatePath("/admin");
  revalidatePath("/products");
}

function revalidateProductRemovalPaths(): void {
  revalidatePath("/admin/products");
  revalidatePath("/admin");
  revalidatePath("/products");
  revalidatePath("/");
}

export async function removeProduct(productId: string): Promise<ProductRemovalResult> {
  await requireRole([ROLES.ADMIN]);

  const parsed = productRemovalSchema.safeParse({ productId });
  if (!parsed.success) {
    return { ok: false, message: "معرّف المنتج غير صالح" };
  }

  try {
    const result = await prisma.$transaction(
      async (tx) => {
        const product = await tx.product.findUnique({
          where: { id: parsed.data.productId },
          select: {
            id: true,
            isActive: true,
            images: { select: { cloudinaryPublicId: true, mediaType: true } },
            inventoryItems: { select: { quantity: true } },
            _count: {
              select: {
                orderItems: true,
                stockMovements: true,
                stockRequestItems: true,
                stockReturnItems: true,
              },
            },
          },
        });

        if (!product) {
          return { kind: "error" as const, message: "المنتج غير موجود أو تم حذفه مسبقًا" };
        }

        const hasHistoricalRecords =
          product._count.orderItems > 0 ||
          product._count.stockMovements > 0 ||
          product._count.stockRequestItems > 0 ||
          product._count.stockReturnItems > 0;

        if (hasHistoricalRecords) {
          if (product.isActive) {
            await tx.product.update({
              where: { id: product.id },
              data: { isActive: false, isFeatured: false },
            });
          }
          return { kind: "archived" as const };
        }

        const positiveStock = product.inventoryItems.reduce(
          (sum, item) => sum + Math.max(0, item.quantity),
          0,
        );
        if (positiveStock > 0) {
          return {
            kind: "error" as const,
            message: `لا يمكن حذف المنتج لأن لديه مخزونًا أكبر من صفر (${positiveStock}) في أحد مواقع المخزون`,
          };
        }

        const hasNegativeStock = product.inventoryItems.some((item) => item.quantity < 0);
        if (hasNegativeStock) {
          return {
            kind: "error" as const,
            message: "لا يمكن حذف المنتج قبل معالجة كميات المخزون السالبة",
          };
        }

        const candidateMedia = product.images.filter(
          (image): image is { cloudinaryPublicId: string; mediaType: string } => image.cloudinaryPublicId !== null,
        );
        const candidateIds = candidateMedia.map((image) => image.cloudinaryPublicId);
        const sharedMedia =
          candidateIds.length > 0
            ? await tx.productImage.findMany({
                where: { productId: { not: product.id }, cloudinaryPublicId: { in: candidateIds } },
                select: { cloudinaryPublicId: true },
              })
            : [];
        const sharedIdSet = new Set(sharedMedia.map((image) => image.cloudinaryPublicId));
        const removableMedia = candidateMedia.filter((image) => !sharedIdSet.has(image.cloudinaryPublicId));

        await tx.cartItem.deleteMany({ where: { productId: product.id } });
        await tx.wishlistItem.deleteMany({ where: { productId: product.id } });
        await tx.inventoryItem.deleteMany({
          where: { productId: product.id, quantity: 0 },
        });
        // Safe unconditionally at this point: hasHistoricalRecords===false
        // already proved zero StockMovement rows reference this product (via
        // either variantId or deviceColorVariantId), and positiveStock===0
        // already proved every InventoryItem row (just deleted above) was
        // zero-quantity — so no DeviceColorVariant combo for this product
        // can have stock or ledger history left to lose.
        await tx.deviceColorVariant.deleteMany({ where: { productId: product.id } });
        await tx.productVariant.deleteMany({ where: { productId: product.id } });
        await tx.product.delete({ where: { id: product.id } });

        return { kind: "deleted" as const, removableMedia };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );

    if (result.kind === "error") return { ok: false, message: result.message };

    revalidateProductRemovalPaths();

    if (result.kind === "archived") {
      return {
        ok: true,
        mode: "archived",
        message: "تم إخفاء المنتج وأرشفته مع الحفاظ على سجلاته السابقة",
      };
    }

    const newlySharedMedia =
      result.removableMedia.length > 0
        ? await prisma.productImage.findMany({
            where: { cloudinaryPublicId: { in: result.removableMedia.map((media) => media.cloudinaryPublicId) } },
            select: { cloudinaryPublicId: true },
          })
        : [];
    const newlySharedIdSet = new Set(newlySharedMedia.map((image) => image.cloudinaryPublicId));
    const stillUnreferencedMedia = result.removableMedia.filter(
      (media) => !newlySharedIdSet.has(media.cloudinaryPublicId),
    );
    const cleanupFailures = await deleteUnreferencedUploadedProductFiles(
      stillUnreferencedMedia.map((media) => ({
        cloudinaryPublicId: media.cloudinaryPublicId,
        mediaType: media.mediaType as MediaType,
      })),
    );
    return {
      ok: true,
      mode: "deleted",
      message:
        cleanupFailures === 0
          ? "تم حذف المنتج نهائيًا بنجاح"
          : "تم حذف المنتج، لكن تعذر تنظيف بعض ملفات الوسائط من الخادم",
    };
  } catch (error) {
    console.error("[admin/products] safe removal failed", {
      route: "/admin/products",
      operation: "remove-product",
      error:
        error instanceof Prisma.PrismaClientKnownRequestError
          ? { name: error.name, code: error.code }
          : error instanceof Error
            ? { name: error.name }
            : { name: "UnknownError" },
    });
    return { ok: false, message: "تعذر حذف أو أرشفة المنتج، حاول مرة أخرى" };
  }
}
