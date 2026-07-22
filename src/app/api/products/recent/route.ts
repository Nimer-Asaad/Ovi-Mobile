import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth/session";
import {
  getPriceModeForUser,
  MERCHANT_PRODUCT_CARD_SELECT,
  PUBLIC_PRODUCT_CARD_SELECT,
} from "@/lib/catalog-queries";

export const dynamic = "force-dynamic";

const requestSchema = z.object({
  ids: z.array(z.string().trim().min(1).max(40)).min(1).max(20),
}).strict();

const responseOptions = { headers: { "Cache-Control": "private, no-store" } };

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "بيانات الطلب غير صالحة" }, { status: 400, ...responseOptions });
  }

  const parsed = requestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "بيانات الطلب غير صالحة" }, { status: 400, ...responseOptions });
  }

  const ids = [...new Set(parsed.data.ids)];
  try {
    const user = await getSession();
    const priceMode = getPriceModeForUser(user);
    const products = priceMode === "wholesale"
      ? await prisma.product.findMany({
          where: { id: { in: ids }, isActive: true },
          select: MERCHANT_PRODUCT_CARD_SELECT,
        })
      : await prisma.product.findMany({
          where: { id: { in: ids }, isActive: true },
          select: PUBLIC_PRODUCT_CARD_SELECT,
        });
    const productsById = new Map(products.map((product) => [product.id, product]));
    return NextResponse.json(
      { products: ids.flatMap((id) => productsById.get(id) ? [productsById.get(id)!] : []) },
      responseOptions,
    );
  } catch (error) {
    console.error("[api/products/recent] query failed", {
      route: "/api/products/recent",
      identifierCount: ids.length,
      message: error instanceof Error ? "Recent product query failed" : "Unknown query failure",
    });
    return NextResponse.json({ error: "تعذر تحميل المنتجات حاليًا" }, { status: 500, ...responseOptions });
  }
}
