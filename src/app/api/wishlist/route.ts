import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth/session";
import { addToWishlist } from "@/lib/wishlist";
import { wishlistProductIdSchema } from "@/lib/validation/wishlist";

export const dynamic = "force-dynamic";
const RESPONSE_HEADERS = { "Cache-Control": "private, no-store" };

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "طلب غير صالح" }, { status: 400, headers: RESPONSE_HEADERS });
  }

  const parsed = wishlistProductIdSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "طلب غير صالح" }, { status: 400, headers: RESPONSE_HEADERS });
  }

  const user = await getSession();
  if (!user) {
    return NextResponse.json({ error: "يجب تسجيل الدخول" }, { status: 401, headers: RESPONSE_HEADERS });
  }

  try {
    const result = await addToWishlist(user.id, parsed.data.productId);
    if (!result.ok) {
      return NextResponse.json({ error: result.message }, { status: 400, headers: RESPONSE_HEADERS });
    }
    return NextResponse.json({ saved: true }, { headers: RESPONSE_HEADERS });
  } catch {
    console.error("[api/wishlist] mutation failed", { route: "/api/wishlist", operation: "add" });
    return NextResponse.json({ error: "تعذر إتمام الطلب" }, { status: 500, headers: RESPONSE_HEADERS });
  }
}
