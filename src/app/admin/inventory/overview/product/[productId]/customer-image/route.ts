import { getSession } from "@/lib/auth/session";
import { ROLES } from "@/lib/constants";
import { customerImageFilename } from "@/lib/inventory-customer-catalog";
import { generateCustomerCatalogPng } from "@/lib/inventory-customer-image";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const NO_STORE = { "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" } as const;

function text(message: string, status: number): Response {
  return new Response(message, { status, headers: { "Content-Type": "text/plain; charset=utf-8", ...NO_STORE } });
}

/** ADMIN-only, read-only: renders the customer-facing "model choices" catalog
 * image (PNG) for one product from its warehouse availability — see
 * src/lib/inventory-customer-image.ts. `?download=1` forces a file download
 * (what the product modal's "صورة للزبون" button uses); without it the PNG is
 * shown inline. It exposes no quantities and writes nothing. */
export async function GET(request: Request, { params }: { params: Promise<{ productId: string }> }) {
  const user = await getSession();
  if (!user) return text("Unauthorized", 401);
  if (user.role !== ROLES.ADMIN) return text("Forbidden", 403);

  const { productId } = await params;
  const result = await generateCustomerCatalogPng(productId);
  if (!result.ok) {
    return result.reason === "NOT_FOUND" ? text("الصنف غير موجود", 404) : text("لا توجد موديلات متوفرة في المخزن لهذا الصنف لعرضها على الزبون", 409);
  }

  const download = new URL(request.url).searchParams.get("download") === "1";
  return new Response(new Uint8Array(result.png), {
    status: 200,
    headers: {
      "Content-Type": "image/png",
      "Content-Length": String(result.png.byteLength),
      "Content-Disposition": `${download ? "attachment" : "inline"}; filename="${customerImageFilename(result.sku)}"`,
      ...NO_STORE,
    },
  });
}
