import "server-only";
import { prisma } from "@/lib/prisma";

/**
 * Active options for a select, plus the currently-assigned row even if it
 * has since been deactivated — so editing an existing product never shows
 * an empty/broken selection just because its category/brand/supplier was
 * turned off later.
 */
export async function getCategoryOptions(currentId?: string | null) {
  const active = await prisma.category.findMany({ where: { isActive: true }, orderBy: { name: "asc" } });
  if (!currentId || active.some((category) => category.id === currentId)) return active;
  const current = await prisma.category.findUnique({ where: { id: currentId } });
  return current ? [...active, current] : active;
}

export async function getBrandOptions(currentId?: string | null) {
  const active = await prisma.brand.findMany({ where: { isActive: true }, orderBy: { name: "asc" } });
  if (!currentId || active.some((brand) => brand.id === currentId)) return active;
  const current = await prisma.brand.findUnique({ where: { id: currentId } });
  return current ? [...active, current] : active;
}

export async function getSupplierOptions(currentId?: string | null) {
  const active = await prisma.supplier.findMany({ where: { isActive: true }, orderBy: { name: "asc" } });
  if (!currentId || active.some((supplier) => supplier.id === currentId)) return active;
  const current = await prisma.supplier.findUnique({ where: { id: currentId } });
  return current ? [...active, current] : active;
}
