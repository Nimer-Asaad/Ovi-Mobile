import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth/session";
import { removeFromWishlist } from "@/lib/wishlist";
import { wishlistProductIdSchema } from "@/lib/validation/wishlist";

export const dynamic = "force-dynamic";
const RESPONSE_HEADERS = { "Cache-Control": "private, no-store" };

interface WishlistDeleteRouteProps {
  params: Promise<{ productId: string }>;
}

export async function DELETE(_request: Request, { params }: WishlistDeleteRouteProps) {
  const parsed = wishlistProductIdSchema.safeParse(await params);
  if (!parsed.success) {
    return NextResponse.json({ error: "طلب غير صالح" }, { status: 400, headers: RESPONSE_HEADERS });
  }

  const user = await getSession();
  if (!user) {
    return NextResponse.json({ error: "يجب تسجيل الدخول" }, { status: 401, headers: RESPONSE_HEADERS });
  }

  try {
    await removeFromWishlist(user.id, parsed.data.productId);
    return NextResponse.json({ saved: false }, { headers: RESPONSE_HEADERS });
  } catch {
    console.error("[api/wishlist/[productId]] mutation failed", { route: "/api/wishlist/[productId]", operation: "remove" });
    return NextResponse.json({ error: "تعذر إتمام الطلب" }, { status: 500, headers: RESPONSE_HEADERS });
  }
}
