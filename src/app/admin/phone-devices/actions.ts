"use server";

import { revalidatePath } from "next/cache";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/auth/guards";
import { ROLES } from "@/lib/constants";
import { slugify } from "@/lib/utils";

export interface PhoneDeviceState { error?: string; success?: string }

export async function createPhoneBrand(_state: PhoneDeviceState, formData: FormData): Promise<PhoneDeviceState> {
  await requireRole([ROLES.ADMIN]);
  const name = formData.get("name")?.toString().trim() ?? "";
  const nameAr = formData.get("nameAr")?.toString().trim() || null;
  if (name.length < 2) return { error: "اسم الماركة مطلوب" };
  const slug = slugify(name) || `phone-brand-${Date.now()}`;
  try {
    await prisma.phoneBrand.create({ data: { name, nameAr, slug } });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") return { error: "هذه الماركة موجودة مسبقاً" };
    throw error;
  }
  revalidatePath("/admin/phone-devices");
  return { success: "تمت إضافة ماركة الهاتف" };
}

export async function createPhoneModel(_state: PhoneDeviceState, formData: FormData): Promise<PhoneDeviceState> {
  await requireRole([ROLES.ADMIN]);
  const phoneBrandId = formData.get("phoneBrandId")?.toString() ?? "";
  const name = formData.get("name")?.toString().trim() ?? "";
  const nameAr = formData.get("nameAr")?.toString().trim() || null;
  if (!phoneBrandId || name.length < 2) return { error: "الماركة واسم الموديل مطلوبان" };
  const slug = slugify(name) || `phone-model-${Date.now()}`;
  try {
    await prisma.phoneModel.create({ data: { phoneBrandId, name, nameAr, slug } });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") return { error: "هذا الموديل موجود مسبقاً تحت الماركة" };
    throw error;
  }
  revalidatePath("/admin/phone-devices");
  return { success: "تمت إضافة موديل الهاتف" };
}

export async function togglePhoneBrand(id: string): Promise<void> {
  await requireRole([ROLES.ADMIN]);
  const row = await prisma.phoneBrand.findUniqueOrThrow({ where: { id }, select: { isActive: true } });
  await prisma.phoneBrand.update({ where: { id }, data: { isActive: !row.isActive } });
  revalidatePath("/admin/phone-devices");
}

export async function togglePhoneModel(id: string): Promise<void> {
  await requireRole([ROLES.ADMIN]);
  const row = await prisma.phoneModel.findUniqueOrThrow({ where: { id }, select: { isActive: true } });
  await prisma.phoneModel.update({ where: { id }, data: { isActive: !row.isActive } });
  revalidatePath("/admin/phone-devices");
}
