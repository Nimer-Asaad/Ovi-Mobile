"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/auth/guards";
import { ROLES } from "@/lib/constants";
import { supplierSchema } from "@/lib/validation/catalog";
import type { z } from "zod";

export interface SupplierFormState {
  error?: string;
  fieldErrors?: Record<string, string>;
}

const DUPLICATE_MESSAGE = "يوجد مورد بنفس الاسم بالفعل";

function parseSupplierForm(formData: FormData) {
  return supplierSchema.safeParse({
    name: formData.get("name")?.toString().trim() ?? "",
    contactName: formData.get("contactName")?.toString().trim() || undefined,
    phone: formData.get("phone")?.toString().trim() || undefined,
    email: formData.get("email")?.toString().trim() || undefined,
    address: formData.get("address")?.toString().trim() || undefined,
    notes: formData.get("notes")?.toString().trim() || undefined,
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

export async function createSupplier(
  _prevState: SupplierFormState,
  formData: FormData,
): Promise<SupplierFormState> {
  await requireRole([ROLES.ADMIN]);

  const parsed = parseSupplierForm(formData);
  if (!parsed.success) {
    return { fieldErrors: fieldErrorsFrom(parsed.error) };
  }

  const existing = await prisma.supplier.findFirst({ where: { name: parsed.data.name } });
  if (existing) {
    return { error: DUPLICATE_MESSAGE };
  }

  await prisma.supplier.create({
    data: {
      name: parsed.data.name,
      contactName: parsed.data.contactName,
      phone: parsed.data.phone,
      email: parsed.data.email,
      address: parsed.data.address,
      notes: parsed.data.notes,
    },
  });

  revalidatePath("/admin/suppliers");
  revalidatePath("/admin");
  redirect("/admin/suppliers");
}

export async function updateSupplier(
  id: string,
  _prevState: SupplierFormState,
  formData: FormData,
): Promise<SupplierFormState> {
  await requireRole([ROLES.ADMIN]);

  const parsed = parseSupplierForm(formData);
  if (!parsed.success) {
    return { fieldErrors: fieldErrorsFrom(parsed.error) };
  }

  const existing = await prisma.supplier.findFirst({
    where: { name: parsed.data.name, id: { not: id } },
  });
  if (existing) {
    return { error: DUPLICATE_MESSAGE };
  }

  await prisma.supplier.update({
    where: { id },
    data: {
      name: parsed.data.name,
      contactName: parsed.data.contactName ?? null,
      phone: parsed.data.phone ?? null,
      email: parsed.data.email ?? null,
      address: parsed.data.address ?? null,
      notes: parsed.data.notes ?? null,
    },
  });

  revalidatePath("/admin/suppliers");
  revalidatePath("/admin");
  redirect("/admin/suppliers");
}

export async function toggleSupplierActive(id: string): Promise<void> {
  await requireRole([ROLES.ADMIN]);

  const supplier = await prisma.supplier.findUniqueOrThrow({ where: { id } });
  await prisma.supplier.update({ where: { id }, data: { isActive: !supplier.isActive } });

  revalidatePath("/admin/suppliers");
  revalidatePath("/admin");
}
