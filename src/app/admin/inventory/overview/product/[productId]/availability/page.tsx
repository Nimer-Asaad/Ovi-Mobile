import Link from "next/link";
import { notFound } from "next/navigation";
import { requireRole } from "@/lib/auth/guards";
import { ROLES } from "@/lib/constants";
import { formatBusinessDateTime } from "@/lib/utils";
import { loadProductAvailabilitySheet } from "@/lib/inventory-availability-sheet";
import { PrintInventorySheetButton } from "@/components/reps/PrintInventorySheetButton";

interface PageProps {
  params: Promise<{ productId: string }>;
}

const PRINT_CSS = `
@page { size: A4 portrait; margin: 12mm; }
@media print {
  html, body { background: #fff !important; }
  /* A long brand list may flow onto the next page, so only keep what must not
     split: each model row, the product header, and a brand heading with its
     first rows. (A whole-brand break-inside:avoid pushed a taller-than-a-page
     brand to a fresh page and left page 1 nearly empty.) */
  .avail-model, .avail-header { break-inside: avoid; page-break-inside: avoid; }
  .avail-brand h3 { break-after: avoid; page-break-after: avoid; }
}
`;

/** ADMIN-only, read-only printable AVAILABILITY sheet for one product — "جرد
 * الصنف". Distinct from the sibling /print route (a company-wide stock-count
 * statement with quantities): this one is based on WAREHOUSE stock only, lists
 * which models/combinations are available (no per-model quantities), and omits
 * every model whose warehouse quantity is below the minimum — see
 * MIN_AVAILABLE_WAREHOUSE_QUANTITY. REP_CAR stock is never read. Nothing here
 * writes anything or hides anything elsewhere in inventory. */
export default async function AdminProductAvailabilitySheetPage({ params }: PageProps) {
  await requireRole([ROLES.ADMIN]);
  const { productId } = await params;

  const sheet = await loadProductAvailabilitySheet(productId);
  if (!sheet) notFound();
  const { product, mode, brands, simpleWarehouseQuantity, hasAvailability } = sheet;
  const showColors = mode === "DEVICE_MODEL_COLOR";
  const columns = Math.min(Math.max(brands.length, 1), 3);

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-4 print:max-w-none" dir="rtl">
      <style>{PRINT_CSS}</style>
      <div className="flex flex-wrap items-center justify-between gap-3 print:hidden">
        <Link href="/admin/inventory/overview" className="text-sm text-gold-champagne hover:underline">
          العودة إلى مخزون الشركة
        </Link>
        <PrintInventorySheetButton />
      </div>

      <div className="avail-sheet rounded-card border border-neutral-200 bg-white px-10 py-9 text-black shadow-sm print:rounded-none print:border-0 print:p-0 print:shadow-none">
        <div className="flex items-end justify-between gap-4 pb-4">
          <div>
            <p className="text-xs font-semibold tracking-wide text-neutral-400">Ovi Mobile</p>
            <h1 className="mt-1 text-[34px] font-extrabold leading-tight">جرد الصنف</h1>
          </div>
          <p className="text-xs text-neutral-500">{formatBusinessDateTime(new Date())}</p>
        </div>

        <div className="avail-header flex items-center gap-6 border-t border-neutral-300 pt-6">
          {product.imageUrl && (
            // eslint-disable-next-line @next/next/no-img-element -- arbitrary admin-entered external URLs, printable sheet renders a plain img
            <img src={product.imageUrl} alt={product.imageAlt ?? product.nameAr ?? product.name} className="h-36 w-36 shrink-0 rounded-card border border-neutral-200 object-contain print:rounded-none print:border-0" />
          )}
          <div className="min-w-0">
            <h2 className="text-[26px] font-extrabold leading-snug" dir="auto">
              {product.nameAr ?? product.name}
            </h2>
            <p className="mt-1 text-[15px] text-neutral-700">
              كود الصنف: <span className="font-semibold" dir="ltr">{product.sku}</span>
            </p>
          </div>
        </div>

        <div className="mt-6 border-t border-neutral-400 pt-6">
          {!hasAvailability ? (
            <p className="py-10 text-center text-lg text-neutral-500">لا يوجد مخزون كافٍ لإظهاره في كشف الجرد</p>
          ) : mode === "TOTAL_STOCK" ? (
            <p className="py-10 text-center text-xl font-bold">
              الكمية المتوفرة في المخزن: <span dir="ltr">{simpleWarehouseQuantity}</span>
            </p>
          ) : (
            <div className="grid gap-x-10 gap-y-7" style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }}>
              {brands.map((brand) => (
                <section key={brand.brandId} className="avail-brand">
                  <h3 className="mb-2.5 border-b-2 border-black pb-1 text-start text-[17px] font-extrabold uppercase tracking-wide" dir="auto">
                    {brand.label}
                  </h3>
                  <ul className="flex flex-col gap-[3px]">
                    {brand.models.map((model) => (
                      <li key={model.modelId} className="avail-model text-start text-[13.5px] font-semibold leading-[18px]" dir="auto">
                        {model.label}
                        {showColors && model.colors.length > 0 && (
                          <span className="font-normal uppercase text-neutral-700"> — {model.colors.map((color) => color.label).join(", ")}</span>
                        )}
                      </li>
                    ))}
                  </ul>
                </section>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
