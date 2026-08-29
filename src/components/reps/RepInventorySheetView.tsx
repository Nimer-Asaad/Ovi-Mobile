import { Fragment } from "react";
import styles from "./RepInventorySheetView.module.css";

export interface RepInventorySheetLine {
  key: string;
  /** Brand / Model[/ Color] label — same flat "Brand / Model" or
   * "Brand / Model / Color" convention already used everywhere else in this
   * app (rep transfer invoice, stock request print view). Null for a
   * TOTAL_STOCK line, which has no dimension to label. */
  label: string | null;
  quantity: number;
  /** True when the underlying ProductVariant/DeviceColorVariant is
   * deactivated — the line still counts (this is a physical count, not a
   * catalog view) but is marked, never hidden. */
  isInactive: boolean;
}

export interface RepInventorySheetProduct {
  productId: string;
  sku: string;
  name: string;
  nameAr: string | null;
  isActive: boolean;
  lines: RepInventorySheetLine[];
  totalQuantity: number;
}

export interface RepInventorySheetData {
  reference: string;
  generatedAt: Date;
  generatedByName: string;
  repName: string;
  repPhone: string | null;
  carLocationName: string;
  products: RepInventorySheetProduct[];
  distinctProductCount: number;
  lineCount: number;
  totalUnits: number;
}

/** Pure, server-renderable printable inventory-count / handover sheet —
 * styled as the same literal white paper document as the existing rep
 * transfer invoice and stock-request print view, with its own distinct
 * heading and wording so it's never confused with either. Every quantity
 * shown is "الكمية بالنظام" (the current InventoryItem quantity) — the three
 * columns after it ("الفعلي" / "الفرق" / "ملاحظات") are deliberately empty:
 * this document exists specifically for the representative to hand-write
 * the physical count against it, nothing here saves that back. */
export function RepInventorySheetView({ data }: { data: RepInventorySheetData }) {
  return (
    <div className="mx-auto max-w-3xl rounded-card border border-neutral-200 bg-white p-8 text-neutral-900 shadow-sm print:m-0 print:max-w-none print:border-0 print:shadow-none">
      <div className="flex flex-wrap items-start justify-between gap-4 border-b border-neutral-200 pb-6">
        <div>
          <h1 className="text-2xl font-bold text-neutral-900">Ovi Mobile</h1>
          <p className="mt-1 text-sm text-neutral-500">كشف جرد مخزون المندوب</p>
        </div>
        <div className="text-end text-sm text-neutral-600">
          <p>
            مرجع الكشف: <span className="font-semibold text-neutral-900">{data.reference}</span>
          </p>
          <p>تاريخ الجرد: {data.generatedAt.toLocaleDateString("ar")}</p>
          <p>وقت الإنشاء: {data.generatedAt.toLocaleTimeString("ar")}</p>
        </div>
      </div>

      <div className="mt-6 grid grid-cols-1 gap-6 sm:grid-cols-2">
        <div>
          <h2 className="text-sm font-semibold text-neutral-500">بيانات المندوب</h2>
          <dl className="mt-2 flex flex-col gap-1 text-sm text-neutral-800">
            <div>
              <dt className="inline text-neutral-500">اسم المندوب: </dt>
              <dd className="inline">{data.repName}</dd>
            </div>
            {data.repPhone && (
              <div>
                <dt className="inline text-neutral-500">رقم الهاتف: </dt>
                <dd className="inline">{data.repPhone}</dd>
              </div>
            )}
            <div>
              <dt className="inline text-neutral-500">سيارة المخزون: </dt>
              <dd className="inline">{data.carLocationName}</dd>
            </div>
          </dl>
        </div>

        <div>
          <h2 className="text-sm font-semibold text-neutral-500">بيانات الكشف</h2>
          <dl className="mt-2 flex flex-col gap-1 text-sm text-neutral-800">
            <div>
              <dt className="inline text-neutral-500">أُنشئ بواسطة: </dt>
              <dd className="inline">{data.generatedByName}</dd>
            </div>
            <div>
              <dt className="inline text-neutral-500">عدد المنتجات المختلفة: </dt>
              <dd className="inline">{data.distinctProductCount}</dd>
            </div>
            <div>
              <dt className="inline text-neutral-500">عدد أصناف الجرد: </dt>
              <dd className="inline">{data.lineCount}</dd>
            </div>
          </dl>
        </div>
      </div>

      <p className="mt-6 rounded-card border border-amber-300/60 bg-amber-50 px-4 py-3 text-sm text-amber-900">
        يقوم المندوب بمطابقة الكمية الفعلية الموجودة في السيارة مع الكمية المسجلة بالنظام أدناه، ويكتب أي فرق أو ملاحظة يدوياً.
      </p>

      <div className="mt-6 overflow-x-auto">
        <table className="w-full text-start text-sm">
          <thead className="border-b border-neutral-200 text-xs font-semibold uppercase tracking-wide text-neutral-500">
            <tr>
              <th className="py-2 text-start">الصنف</th>
              <th className="py-2 text-start">الكمية بالنظام</th>
              <th className="py-2 text-start">الكمية الفعلية</th>
              <th className="py-2 text-start">الفرق</th>
              <th className="py-2 text-start">ملاحظات</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-neutral-100">
            {data.products.map((product) => {
              const singleLine = product.lines.length === 1;
              const productLabel = `${product.nameAr ?? product.name} — SKU: ${product.sku}`;
              return (
                <Fragment key={product.productId}>
                  {singleLine ? (
                    <tr className={styles.avoidBreak}>
                      <td className="py-2 text-neutral-900">
                        {productLabel}
                        {!product.isActive && <span className="ms-2 text-xs text-neutral-400">(غير نشط)</span>}
                        {product.lines[0]!.label && (
                          <span className="block text-xs text-neutral-500">
                            {product.lines[0]!.label}
                            {product.lines[0]!.isInactive && <span className="ms-1 text-neutral-400">(غير نشط)</span>}
                          </span>
                        )}
                      </td>
                      <td className="py-2 font-medium text-neutral-900">{product.lines[0]!.quantity}</td>
                      <td className="py-2">&nbsp;</td>
                      <td className="py-2">&nbsp;</td>
                      <td className="py-2">&nbsp;</td>
                    </tr>
                  ) : (
                    <>
                      <tr key={`${product.productId}-header`} className={`${styles.avoidBreak} bg-neutral-50`}>
                        <td className="py-2 font-semibold text-neutral-900" colSpan={5}>
                          {productLabel}
                          {!product.isActive && <span className="ms-2 text-xs text-neutral-400">(غير نشط)</span>}
                        </td>
                      </tr>
                      {product.lines.map((line) => (
                        <tr key={`${product.productId}-${line.key}`} className={styles.avoidBreak}>
                          <td className="py-2 ps-4 text-neutral-800">
                            {line.label ?? "بدون تصنيف"}
                            {line.isInactive && <span className="ms-1 text-xs text-neutral-400">(غير نشط)</span>}
                          </td>
                          <td className="py-2 font-medium text-neutral-900">{line.quantity}</td>
                          <td className="py-2">&nbsp;</td>
                          <td className="py-2">&nbsp;</td>
                          <td className="py-2">&nbsp;</td>
                        </tr>
                      ))}
                      <tr key={`${product.productId}-subtotal`} className={`${styles.avoidBreak} font-semibold text-neutral-900`}>
                        <td className="py-2 ps-4">إجمالي المنتج</td>
                        <td className="py-2">{product.totalQuantity}</td>
                        <td className="py-2" colSpan={3} />
                      </tr>
                    </>
                  )}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="mt-6 grid grid-cols-1 gap-2 border-t border-neutral-200 pt-4 text-sm sm:grid-cols-3">
        <p>
          <span className="text-neutral-500">عدد المنتجات المختلفة: </span>
          <span className="font-semibold text-neutral-900">{data.distinctProductCount}</span>
        </p>
        <p>
          <span className="text-neutral-500">عدد أصناف الجرد: </span>
          <span className="font-semibold text-neutral-900">{data.lineCount}</span>
        </p>
        <p>
          <span className="text-neutral-500">إجمالي عدد القطع: </span>
          <span className="font-semibold text-neutral-900">{data.totalUnits}</span>
        </p>
      </div>

      <div className={`${styles.avoidBreak} mt-10 border-t border-neutral-200 pt-6`}>
        <p className="text-sm text-neutral-800">
          أقر بأنني قمت بمراجعة ومطابقة الكميات الموضحة في كشف الجرد أعلاه مع المخزون الفعلي، وتم تسجيل أي فروقات أو ملاحظات على الكشف.
        </p>

        <div className="mt-8 grid grid-cols-1 gap-8 text-sm sm:grid-cols-2">
          <div>
            <p className="font-semibold text-neutral-700">المسلم / مسؤول الجرد</p>
            <p className="mt-4 text-neutral-500">
              الاسم: <span className="inline-block w-40 border-b border-neutral-300">&nbsp;</span>
            </p>
            <p className="mt-4 text-neutral-500">
              التوقيع: <span className="inline-block w-40 border-b border-neutral-300">&nbsp;</span>
            </p>
            <p className="mt-4 text-neutral-500">
              التاريخ: <span className="inline-block w-40 border-b border-neutral-300">&nbsp;</span>
            </p>
          </div>

          <div>
            <p className="font-semibold text-neutral-700">المندوب المستلم</p>
            <p className="mt-2 text-xs text-neutral-500">أقر باستلام ومراجعة المخزون الموضح أعلاه.</p>
            <p className="mt-3 text-neutral-500">
              الاسم: <span className="font-medium text-neutral-900">{data.repName}</span>
            </p>
            <p className="mt-4 text-neutral-500">
              التوقيع: <span className="inline-block w-40 border-b border-neutral-300">&nbsp;</span>
            </p>
            <p className="mt-4 text-neutral-500">
              التاريخ: <span className="inline-block w-40 border-b border-neutral-300">&nbsp;</span>
            </p>
          </div>
        </div>
      </div>

      <p className="mt-8 text-center text-xs text-neutral-400">
        هذا كشف جرد داخلي وليس فاتورة بيع لعميل
      </p>
    </div>
  );
}
