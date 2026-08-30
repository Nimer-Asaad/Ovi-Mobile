"use server";

import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/auth/guards";
import { ROLES } from "@/lib/constants";
import { repSaleSchema } from "@/lib/validation/repSale";
import { createRepSaleCore } from "@/lib/rep-sales";

export interface RepSaleState {
  error?: string;
}

const PARSE_ERROR_MESSAGE = "بيانات البيع غير صالحة";

/** Thin wrapper around the shared sale transaction (createRepSaleCore in
 * src/lib/rep-sales.ts) for a rep selling their own car stock: authorizes
 * SALES_REPRESENTATIVE, resolves "my own rep row + my own car location"
 * from the session, parses the form, then hands off to the core. An admin
 * recording a sale on a rep's behalf (createRepSaleForRep in
 * src/app/admin/reps/actions.ts) is the only other caller of that same
 * core — there is exactly one sale transaction in this codebase. */
export async function createRepSale(_prevState: RepSaleState, formData: FormData): Promise<RepSaleState> {
  const user = await requireRole([ROLES.SALES_REPRESENTATIVE]);

  let items: unknown;
  try {
    items = JSON.parse(formData.get("items")?.toString() ?? "[]");
  } catch {
    return { error: PARSE_ERROR_MESSAGE };
  }

  const parsed = repSaleSchema.safeParse({
    items,
    customerName: formData.get("customerName")?.toString().trim() ?? "",
    customerPhone: formData.get("customerPhone")?.toString().trim() ?? "",
    city: formData.get("city")?.toString().trim() || undefined,
    address: formData.get("address")?.toString().trim() || undefined,
    notes: formData.get("notes")?.toString().trim() || undefined,
    repCustomerOrderId: formData.get("repCustomerOrderId")?.toString().trim() || null,
  });

  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? PARSE_ERROR_MESSAGE };
  }

  const rep = await prisma.salesRepresentative.findUnique({
    where: { userId: user.id },
    select: { id: true, carStockLocation: { select: { id: true } } },
  });
  if (!rep) {
    return { error: "لم يتم العثور على ملف المندوب" };
  }

  const locationId = rep.carStockLocation?.id ?? null;
  if (!locationId) {
    return { error: "لم يتم العثور على موقع مخزون المندوب" };
  }

  const result = await createRepSaleCore(parsed.data, {
    salesRepId: rep.id,
    carStockLocationId: locationId,
    actorUserId: user.id,
  });

  if (!result.ok) {
    return { error: result.error };
  }

  redirect(`/rep/sales/${result.orderNumber}`);
}
