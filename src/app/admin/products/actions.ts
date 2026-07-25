"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/auth/guards";
import { ROLES } from "@/lib/constants";
import { productSchema } from "@/lib/validation/catalog";
import { validateMediaBuffer, inferMediaTypeFromUrl, type MediaType } from "@/lib/validation/productMedia";
import { deleteUnreferencedUploadedProductFiles, saveUploadedProductFile } from "@/lib/uploads";
import { productRemovalSchema } from "@/lib/validation/productRemoval";
import type { z } from "zod";

export interface ProductFormState {
  error?: string;
  fieldErrors?: Record<string, string>;
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
}

type CollectMediaResult = { ok: true; entries: { url: string; mediaType: MediaType; isMain: boolean }[] } | { ok: false; error: string };

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
      if (url && (mediaType === "IMAGE" || mediaType === "VIDEO")) {
        slotEntries.push({ url, mediaType });
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
        slotEntries.push({ url: saved.url, mediaType: validation.mediaType });
        continue;
      }

      const url = formData.get(`media_${i}_url`)?.toString().trim();
      if (url) {
        if (!/^https?:\/\//.test(url)) {
          return { ok: false, error: INVALID_MEDIA_URL_MESSAGE };
        }
        slotEntries.push({ url, mediaType: inferMediaTypeFromUrl(url) });
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

async function replaceProductImages(
  productId: string,
  entries: { url: string; mediaType: MediaType; isMain: boolean }[],
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

  const existingSku = await prisma.product.findUnique({ where: { sku: parsed.data.sku } });
  if (existingSku) {
    return { error: DUPLICATE_SKU_MESSAGE };
  }

  const isFeatured = formData.get("isFeatured") === "on";

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

  revalidatePath("/admin/products");
  revalidatePath("/admin");
  revalidatePath("/products");
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

  revalidatePath("/admin/products");
  revalidatePath("/admin");
  revalidatePath("/products");
  redirect("/admin/products");
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
            images: { select: { url: true } },
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

        const candidateUrls = product.images
          .map((image) => image.url)
          .filter((url) => url.startsWith("/uploads/products/"));
        const sharedUrls =
          candidateUrls.length > 0
            ? await tx.productImage.findMany({
                where: { productId: { not: product.id }, url: { in: candidateUrls } },
                select: { url: true },
              })
            : [];
        const sharedUrlSet = new Set(sharedUrls.map((image) => image.url));
        const removableUrls = candidateUrls.filter((url) => !sharedUrlSet.has(url));

        await tx.cartItem.deleteMany({ where: { productId: product.id } });
        await tx.wishlistItem.deleteMany({ where: { productId: product.id } });
        await tx.inventoryItem.deleteMany({
          where: { productId: product.id, quantity: 0 },
        });
        await tx.product.delete({ where: { id: product.id } });

        return { kind: "deleted" as const, removableUrls };
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

    const newlySharedUrls =
      result.removableUrls.length > 0
        ? await prisma.productImage.findMany({
            where: { url: { in: result.removableUrls } },
            select: { url: true },
          })
        : [];
    const newlySharedUrlSet = new Set(newlySharedUrls.map((image) => image.url));
    const stillUnreferencedUrls = result.removableUrls.filter(
      (url) => !newlySharedUrlSet.has(url),
    );
    const cleanupFailures =
      await deleteUnreferencedUploadedProductFiles(stillUnreferencedUrls);
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
