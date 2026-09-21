import Link from "next/link";
import { notFound } from "next/navigation";
import { requireRole } from "@/lib/auth/guards";
import { ROLES } from "@/lib/constants";
import { formatBusinessDateTime } from "@/lib/utils";
import { loadProductInventoryPrint } from "@/lib/inventory-product-print";
import { PrintInventorySheetButton } from "@/components/reps/PrintInventorySheetButton";

interface PageProps {
  params: Promise<{ productId: string }>;
}

const PRINT_CSS = `
@page { size: A4 portrait; margin: 10mm; }
@media print {
  html, body { background: #fff !important; }
  .inv-print thead { display: table-header-group; }
  .inv-print tr { break-inside: avoid; page-break-inside: avoid; }
}
`;

/** ADMIN-only, read-only printable stock statement for one product across
 * the whole company (warehouse + every rep car), built from the same
 * canonical pipeline as /admin/inventory/overview. */
export default async function AdminProductInventoryPrintPage({ params }: PageProps) {
  await requireRole([ROLES.ADMIN]);
  const { productId } = await params;

  const data = await loadProductInventoryPrint(productId);
  if (!data) notFound();
  const { product, brandLabel, locationLabels, sortedGroups } = data;

  const isDimensional = product.displayMode !== "TOTAL_STOCK";
  const hasColor = sortedGroups.some((group) => group.colorLabel !== null);
  const columnCount = isDimensional && hasColor ? 3 : 2;
  const locationRows = Object.entries(product.byLocation)
    .filter(([, quantity]) => quantity > 0)
    .map(([id, quantity]) => ({ id, label: locationLabels[id] ?? id, quantity }))
    .sort((a, b) => b.quantity - a.quantity);

  const header: [string, string][] = [
    ["اسم المنتج", product.nameAr ?? product.name],
    ["SKU", product.sku],
    ["التصنيف", product.categoryLabel ?? "—"],
    ["الماركة", brandLabel ?? "—"],
    ["الموقع", "مخزون الشركة"],
    ["التاريخ والوقت", formatBusinessDateTime(new Date())],
    ["إجمالي كمية المنتج", `${product.total} قطعة`],
  ];

  const cell = "border border-neutral-400 px-2 py-1";

  return (
    <div className="inv-print mx-auto flex max-w-3xl flex-col gap-4 print:max-w-none" dir="rtl">
      <style>{PRINT_CSS}</style>
      <div className="flex flex-wrap items-center justify-between gap-3 print:hidden">
        <Link href="/admin/inventory/overview" className="text-sm text-gold-champagne hover:underline">
          العودة إلى مخزون الشركة
        </Link>
        <PrintInventorySheetButton />
      </div>

      <div className="rounded-card border border-neutral-200 bg-white p-6 text-neutral-900 print:border-0 print:p-0">
        <h1 className="mb-3 text-lg font-bold">كشف مخزون المنتج</h1>
        <dl className="mb-4 grid grid-cols-2 gap-x-6 gap-y-1 text-sm sm:grid-cols-3">
          {header.map(([label, value]) => (
            <div key={label}>
              <dt className="text-xs text-neutral-500">{label}</dt>
              <dd className="font-semibold">{value}</dd>
            </div>
          ))}
        </dl>

        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="bg-neutral-100">
              <th className={`${cell} text-start`}>{isDimensional ? "الصنف / الموديل" : "الموقع"}</th>
              {columnCount === 3 && <th className={`${cell} text-start`}>اللون / النوع</th>}
              <th className={`${cell} w-24 text-center`}>الكمية</th>
            </tr>
          </thead>
          <tbody>
            {!isDimensional &&
              locationRows.map((row) => (
                <tr key={row.id}>
                  <td className={cell}>{row.label}</td>
                  <td className={`${cell} text-center`}>{row.quantity}</td>
                </tr>
              ))}
            {isDimensional &&
              sortedGroups.map((group, index) => {
                const showBrand = index === 0 || sortedGroups[index - 1]!.brandId !== group.brandId;
                return [
                  showBrand && (
                    <tr key={`brand:${group.brandId || "unclassified"}`} className="bg-neutral-50">
                      <td colSpan={columnCount} className={`${cell} font-bold`}>
                        {group.brandLabel}
                      </td>
                    </tr>
                  ),
                  <tr key={group.key}>
                    <td className={cell}>{group.modelLabel}</td>
                    {columnCount === 3 && <td className={cell}>{group.colorLabel ?? "—"}</td>}
                    <td className={`${cell} text-center`}>{group.total}</td>
                  </tr>,
                ];
              })}
            {product.total === 0 && (
              <tr>
                <td colSpan={columnCount} className={`${cell} text-center text-neutral-500`}>
                  لا يوجد مخزون لهذا المنتج حالياً
                </td>
              </tr>
            )}
          </tbody>
        </table>

        <p className="mt-4 text-base font-bold">إجمالي الكمية: {product.total} قطعة</p>
      </div>
    </div>
  );
}
