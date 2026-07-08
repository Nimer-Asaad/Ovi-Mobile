"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/auth/guards";
import { ROLES } from "@/lib/constants";
import { brandSchema } from "@/lib/validation/catalog";
import { slugify } from "@/lib/utils";
import type { z } from "zod";

export interface BrandFormState {
  error?: string;
  fieldErrors?: Record<string, string>;
}

const DUPLICATE_MESSAGE = "يوجد علامة تجارية بنفس الاسم أو الرابط بالفعل";

function parseBrandForm(formData: FormData) {
  return brandSchema.safeParse({
    name: formData.get("name")?.toString().trim() ?? "",
    logoUrl: formData.get("logoUrl")?.toString().trim() || undefined,
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

export async function createBrand(
  _prevState: BrandFormState,
  formData: FormData,
): Promise<BrandFormState> {
  await requireRole([ROLES.ADMIN]);

  const parsed = parseBrandForm(formData);
  if (!parsed.success) {
    return { fieldErrors: fieldErrorsFrom(parsed.error) };
  }

  const slug = slugify(parsed.data.name) || "brand";
  const existing = await prisma.brand.findFirst({ where: { slug } });
  if (existing) {
    return { error: DUPLICATE_MESSAGE };
  }

  try {
    await prisma.brand.create({
      data: { name: parsed.data.name, slug, logoUrl: parsed.data.logoUrl },
    });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      return { error: DUPLICATE_MESSAGE };
    }
    throw err;
  }

  revalidatePath("/admin/brands");
  revalidatePath("/admin");
  redirect("/admin/brands");
}

export async function updateBrand(
  id: string,
  _prevState: BrandFormState,
  formData: FormData,
): Promise<BrandFormState> {
  await requireRole([ROLES.ADMIN]);

  const parsed = parseBrandForm(formData);
  if (!parsed.success) {
    return { fieldErrors: fieldErrorsFrom(parsed.error) };
  }

  const slug = slugify(parsed.data.name) || "brand";
  const existing = await prisma.brand.findFirst({ where: { slug, id: { not: id } } });
  if (existing) {
    return { error: DUPLICATE_MESSAGE };
  }

  try {
    await prisma.brand.update({
      where: { id },
      data: { name: parsed.data.name, slug, logoUrl: parsed.data.logoUrl ?? null },
    });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      return { error: DUPLICATE_MESSAGE };
    }
    throw err;
  }

  revalidatePath("/admin/brands");
  revalidatePath("/admin");
  redirect("/admin/brands");
}

export async function toggleBrandActive(id: string): Promise<void> {
  await requireRole([ROLES.ADMIN]);

  const brand = await prisma.brand.findUniqueOrThrow({ where: { id } });
  await prisma.brand.update({ where: { id }, data: { isActive: !brand.isActive } });

  revalidatePath("/admin/brands");
  revalidatePath("/admin");
}
