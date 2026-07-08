"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/auth/guards";
import { ROLES } from "@/lib/constants";
import { productSchema, productImagesSchema } from "@/lib/validation/catalog";
import type { z } from "zod";

export interface ProductFormState {
  error?: string;
  fieldErrors?: Record<string, string>;
}

const DUPLICATE_SKU_MESSAGE = "رمز المنتج (SKU) مستخدم بالفعل";
const DUPLICATE_IMAGE_MESSAGE = "لا يمكن استخدام نفس رابط الصورة أكثر من مرة";

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

function parseImagesForm(formData: FormData) {
  return productImagesSchema.safeParse({
    mainImageUrl: formData.get("mainImageUrl")?.toString().trim() || undefined,
    imageUrl2: formData.get("imageUrl2")?.toString().trim() || undefined,
    imageUrl3: formData.get("imageUrl3")?.toString().trim() || undefined,
    imageUrl4: formData.get("imageUrl4")?.toString().trim() || undefined,
    imageUrl5: formData.get("imageUrl5")?.toString().trim() || undefined,
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

/** Ordered, de-duplicated list of non-empty image URLs from the 5 form
 * fields (main first, then additional 1-4). Returns null if a URL repeats. */
function collectImageUrls(images: {
  mainImageUrl?: string;
  imageUrl2?: string;
  imageUrl3?: string;
  imageUrl4?: string;
  imageUrl5?: string;
}): string[] | null {
  const urls = [images.mainImageUrl, images.imageUrl2, images.imageUrl3, images.imageUrl4, images.imageUrl5].filter(
    (url): url is string => typeof url === "string" && url.trim() !== "",
  );

  if (new Set(urls).size !== urls.length) {
    return null;
  }

  return urls;
}

async function replaceProductImages(productId: string, urls: string[], productName: string): Promise<void> {
  await prisma.$transaction([
    prisma.productImage.deleteMany({ where: { productId } }),
    ...(urls.length > 0
      ? [
          prisma.productImage.createMany({
            data: urls.map((url, index) => ({
              productId,
              url,
              altText: productName,
              isMain: index === 0,
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
  const imagesParsed = parseImagesForm(formData);

  if (!parsed.success || !imagesParsed.success) {
    const fieldErrors: Record<string, string> = {};
    if (!parsed.success) Object.assign(fieldErrors, fieldErrorsFrom(parsed.error));
    if (!imagesParsed.success) Object.assign(fieldErrors, fieldErrorsFrom(imagesParsed.error));
    return { fieldErrors };
  }

  const imageUrls = collectImageUrls(imagesParsed.data);
  if (imageUrls === null) {
    return { error: DUPLICATE_IMAGE_MESSAGE };
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

  if (imageUrls.length > 0) {
    await replaceProductImages(productId, imageUrls, parsed.data.name);
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
  const imagesParsed = parseImagesForm(formData);

  if (!parsed.success || !imagesParsed.success) {
    const fieldErrors: Record<string, string> = {};
    if (!parsed.success) Object.assign(fieldErrors, fieldErrorsFrom(parsed.error));
    if (!imagesParsed.success) Object.assign(fieldErrors, fieldErrorsFrom(imagesParsed.error));
    return { fieldErrors };
  }

  const imageUrls = collectImageUrls(imagesParsed.data);
  if (imageUrls === null) {
    return { error: DUPLICATE_IMAGE_MESSAGE };
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

  await replaceProductImages(id, imageUrls, parsed.data.name);

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
