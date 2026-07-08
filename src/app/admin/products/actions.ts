"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/auth/guards";
import { ROLES } from "@/lib/constants";
import { productSchema } from "@/lib/validation/catalog";
import type { z } from "zod";

export interface ProductFormState {
  error?: string;
  fieldErrors?: Record<string, string>;
}

const DUPLICATE_SKU_MESSAGE = "رمز المنتج (SKU) مستخدم بالفعل";

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

export async function createProduct(
  _prevState: ProductFormState,
  formData: FormData,
): Promise<ProductFormState> {
  await requireRole([ROLES.ADMIN]);

  const parsed = parseProductForm(formData);
  if (!parsed.success) {
    return { fieldErrors: fieldErrorsFrom(parsed.error) };
  }

  const existingSku = await prisma.product.findUnique({ where: { sku: parsed.data.sku } });
  if (existingSku) {
    return { error: DUPLICATE_SKU_MESSAGE };
  }

  const isFeatured = formData.get("isFeatured") === "on";

  try {
    await prisma.product.create({
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
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      return { error: DUPLICATE_SKU_MESSAGE };
    }
    throw err;
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
