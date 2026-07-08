"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/auth/guards";
import { ROLES } from "@/lib/constants";
import { categorySchema } from "@/lib/validation/catalog";
import { slugify } from "@/lib/utils";
import type { z } from "zod";

export interface CategoryFormState {
  error?: string;
  fieldErrors?: Record<string, string>;
}

const DUPLICATE_MESSAGE = "يوجد قسم بنفس الاسم أو الرابط بالفعل";

function parseCategoryForm(formData: FormData) {
  return categorySchema.safeParse({
    name: formData.get("name")?.toString().trim() ?? "",
    nameAr: formData.get("nameAr")?.toString().trim() || undefined,
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

export async function createCategory(
  _prevState: CategoryFormState,
  formData: FormData,
): Promise<CategoryFormState> {
  await requireRole([ROLES.ADMIN]);

  const parsed = parseCategoryForm(formData);
  if (!parsed.success) {
    return { fieldErrors: fieldErrorsFrom(parsed.error) };
  }

  const slug = slugify(parsed.data.name) || "category";
  const existing = await prisma.category.findFirst({ where: { slug } });
  if (existing) {
    return { error: DUPLICATE_MESSAGE };
  }

  try {
    await prisma.category.create({
      data: { name: parsed.data.name, nameAr: parsed.data.nameAr, slug },
    });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      return { error: DUPLICATE_MESSAGE };
    }
    throw err;
  }

  revalidatePath("/admin/categories");
  revalidatePath("/admin");
  revalidatePath("/");
  redirect("/admin/categories");
}

export async function updateCategory(
  id: string,
  _prevState: CategoryFormState,
  formData: FormData,
): Promise<CategoryFormState> {
  await requireRole([ROLES.ADMIN]);

  const parsed = parseCategoryForm(formData);
  if (!parsed.success) {
    return { fieldErrors: fieldErrorsFrom(parsed.error) };
  }

  const slug = slugify(parsed.data.name) || "category";
  const existing = await prisma.category.findFirst({ where: { slug, id: { not: id } } });
  if (existing) {
    return { error: DUPLICATE_MESSAGE };
  }

  try {
    await prisma.category.update({
      where: { id },
      data: { name: parsed.data.name, nameAr: parsed.data.nameAr ?? null, slug },
    });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      return { error: DUPLICATE_MESSAGE };
    }
    throw err;
  }

  revalidatePath("/admin/categories");
  revalidatePath("/admin");
  revalidatePath("/");
  redirect("/admin/categories");
}

export async function toggleCategoryActive(id: string): Promise<void> {
  await requireRole([ROLES.ADMIN]);

  const category = await prisma.category.findUniqueOrThrow({ where: { id } });
  await prisma.category.update({ where: { id }, data: { isActive: !category.isActive } });

  revalidatePath("/admin/categories");
  revalidatePath("/admin");
  revalidatePath("/");
}
