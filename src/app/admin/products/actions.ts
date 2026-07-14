"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/auth/guards";
import { ROLES } from "@/lib/constants";
import { productSchema } from "@/lib/validation/catalog";
import { validateMediaFile, inferMediaTypeFromUrl, type MediaType } from "@/lib/validation/productMedia";
import { saveUploadedProductFile } from "@/lib/uploads";
import type { z } from "zod";

export interface ProductFormState {
  error?: string;
  fieldErrors?: Record<string, string>;
}

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
        const validation = validateMediaFile(file);
        if (!validation.ok || !validation.mediaType || !validation.extension) {
          return { ok: false, error: validation.error ?? "ملف وسائط غير صالح" };
        }
        const savedUrl = await saveUploadedProductFile(file, validation.extension);
        slotEntries.push({ url: savedUrl, mediaType: validation.mediaType });
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
