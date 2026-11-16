"use server";

import { revalidatePath } from "next/cache";
import { requireRole } from "@/lib/auth/guards";
import { ROLES } from "@/lib/constants";
import { addProductCompatibility, removeProductCompatibility, type CompatibilityChangeResult } from "@/lib/product-phone-compatibility";

export interface CompatibilityActionState {
  error?: string;
  success?: string;
}

function readIdList(formData: FormData, key: string): string[] {
  try {
    const parsed: unknown = JSON.parse(formData.get(key)?.toString() ?? "[]");
    return Array.isArray(parsed) ? parsed.filter((value): value is string => typeof value === "string") : [];
  } catch {
    return [];
  }
}

function revalidateCompatibilityPaths(productIds: string[]): void {
  revalidatePath("/admin/products/compatibility");
  for (const productId of productIds.slice(0, 50)) revalidatePath(`/admin/products/${productId}/edit`);
  revalidatePath("/admin/inventory/overview");
}

/** Shared by both screens (the per-product "توافق الأجهزة" section and the bulk
 * page): `productIds` and `phoneModelIds` are JSON arrays in the form. ADMIN
 * only — product management is ADMIN-only (see admin/products/layout.tsx), so
 * nothing here widens ADMIN_ASSISTANT. METADATA ONLY: the library never touches
 * stock, variants or product status. */
async function run(formData: FormData, change: (input: { productIds: string[]; phoneModelIds: string[] }) => Promise<CompatibilityChangeResult>, done: (changed: number) => string): Promise<CompatibilityActionState> {
  await requireRole([ROLES.ADMIN]);
  const productIds = readIdList(formData, "productIds");
  const phoneModelIds = readIdList(formData, "phoneModelIds");
  const result = await change({ productIds, phoneModelIds });
  if (!result.ok) return { error: result.error };
  revalidateCompatibilityPaths(productIds);
  return { success: done(result.changed) };
}

export async function addCompatibilityAction(_prevState: CompatibilityActionState, formData: FormData): Promise<CompatibilityActionState> {
  return run(formData, addProductCompatibility, (changed) => (changed > 0 ? `تمت إضافة ${changed} ربط جديد` : "كل الربط المحدد موجود مسبقاً — لم يتغيّر شيء"));
}

export async function removeCompatibilityAction(_prevState: CompatibilityActionState, formData: FormData): Promise<CompatibilityActionState> {
  return run(formData, removeProductCompatibility, (changed) => (changed > 0 ? `تمت إزالة ${changed} ربط` : "لا يوجد ربط مطابق لإزالته"));
}
