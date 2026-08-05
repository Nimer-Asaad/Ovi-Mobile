"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/auth/guards";
import { ROLES } from "@/lib/constants";
import { colorSchema } from "@/lib/validation/catalog";
import type { z } from "zod";

export interface ColorFormState {
  error?: string;
  fieldErrors?: Record<string, string>;
}

const DUPLICATE_MESSAGE = "يوجد لون بنفس الاسم بالفعل";

function parseColorForm(formData: FormData) {
  return colorSchema.safeParse({
    name: formData.get("name")?.toString().trim() ?? "",
    nameAr: formData.get("nameAr")?.toString().trim() || undefined,
    hexCode: formData.get("hexCode")?.toString().trim() || undefined,
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

export async function createColor(_prevState: ColorFormState, formData: FormData): Promise<ColorFormState> {
  await requireRole([ROLES.ADMIN]);

  const parsed = parseColorForm(formData);
  if (!parsed.success) {
    return { fieldErrors: fieldErrorsFrom(parsed.error) };
  }

  const existing = await prisma.color.findFirst({ where: { name: parsed.data.name } });
  if (existing) {
    return { error: DUPLICATE_MESSAGE };
  }

  try {
    await prisma.color.create({
      data: { name: parsed.data.name, nameAr: parsed.data.nameAr, hexCode: parsed.data.hexCode },
    });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      return { error: DUPLICATE_MESSAGE };
    }
    throw err;
  }

  revalidatePath("/admin/colors");
  revalidatePath("/admin");
  redirect("/admin/colors");
}

export async function updateColor(
  id: string,
  _prevState: ColorFormState,
  formData: FormData,
): Promise<ColorFormState> {
  await requireRole([ROLES.ADMIN]);

  const parsed = parseColorForm(formData);
  if (!parsed.success) {
    return { fieldErrors: fieldErrorsFrom(parsed.error) };
  }

  const existing = await prisma.color.findFirst({ where: { name: parsed.data.name, id: { not: id } } });
  if (existing) {
    return { error: DUPLICATE_MESSAGE };
  }

  try {
    await prisma.color.update({
      where: { id },
      data: {
        name: parsed.data.name,
        nameAr: parsed.data.nameAr ?? null,
        hexCode: parsed.data.hexCode ?? null,
      },
    });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      return { error: DUPLICATE_MESSAGE };
    }
    throw err;
  }

  revalidatePath("/admin/colors");
  revalidatePath("/admin");
  redirect("/admin/colors");
}

export async function toggleColorActive(id: string): Promise<void> {
  await requireRole([ROLES.ADMIN]);

  const color = await prisma.color.findUniqueOrThrow({ where: { id } });
  await prisma.color.update({ where: { id }, data: { isActive: !color.isActive } });

  revalidatePath("/admin/colors");
  revalidatePath("/admin");
}
