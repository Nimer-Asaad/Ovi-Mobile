export interface TransferInvoiceLineItem {
  product: { sku: string; name: string; nameAr: string | null };
  optionLabel: string | null;
  quantity: number;
  previousQuantity: number | null;
  newQuantity: number | null;
}

export interface TransferInvoiceData {
  id: string;
  createdAt: Date;
  /** "تخصيص مخزون لمندوب" | "إرجاع مخزون من مندوب" — the Arabic label for
   * the transfer direction, resolved by the caller from the batch/movement
   * type so this component stays a pure renderer. */
  typeLabel: string;
  items: TransferInvoiceLineItem[];
  note: string | null;
  fromLocationName: string | null;
  toLocationName: string | null;
  repName: string;
  repEmployeeCode: string;
  preparedByName: string | null;
}

/** Pure, server-renderable printable transfer/delivery note. Styled as a
 * literal white paper document like the customer sales invoice (Phase 25),
 * but deliberately a separate component with its own "stock transfer to/from
 * the car" wording — never to be confused with a customer sales invoice.
 * Renders every product moved by one admin quick-transfer submission
 * (RepStockTransferBatch) as a single combined invoice — or, for a legacy
 * transfer that predates batching, a one-row invoice for that single
 * StockMovement. Reads every value straight from already-created rows;
 * renders nothing that could imply a new movement is being created by
 * viewing it. */
export function RepTransferInvoiceView({ movement }: { movement: TransferInvoiceData }) {
  const totalQuantity = movement.items.reduce((sum, item) => sum + item.quantity, 0);

  return (
    <div className="mx-auto max-w-3xl rounded-card border border-neutral-200 bg-white p-8 text-neutral-900 shadow-sm print:m-0 print:max-w-none print:border-0 print:shadow-none">
      <div className="flex flex-wrap items-start justify-between gap-4 border-b border-neutral-200 pb-6">
        <div>
          <h1 className="text-2xl font-bold text-neutral-900">Ovi Mobile</h1>
          <p className="mt-1 text-sm text-neutral-500">{movement.typeLabel}</p>
        </div>
        <div className="text-end text-sm text-neutral-600">
          <p>
            رقم الحركة: <span className="font-semibold text-neutral-900">{movement.id}</span>
          </p>
          <p>التاريخ: {new Date(movement.createdAt).toLocaleDateString("ar")}</p>
        </div>
      </div>

      <div className="mt-6 grid grid-cols-1 gap-6 sm:grid-cols-2">
        <div>
          <h2 className="text-sm font-semibold text-neutral-500">بيانات المندوب</h2>
          <dl className="mt-2 flex flex-col gap-1 text-sm text-neutral-800">
            <div>
              <dt className="inline text-neutral-500">المندوب: </dt>
              <dd className="inline">{movement.repName}</dd>
            </div>
            <div>
              <dt className="inline text-neutral-500">الرقم الوظيفي: </dt>
              <dd className="inline">{movement.repEmployeeCode}</dd>
            </div>
            {movement.preparedByName && (
              <div>
                <dt className="inline text-neutral-500">تم التحضير بواسطة: </dt>
                <dd className="inline">{movement.preparedByName}</dd>
              </div>
            )}
          </dl>
        </div>

        <div>
          <h2 className="text-sm font-semibold text-neutral-500">بيانات النقل</h2>
          <dl className="mt-2 flex flex-col gap-1 text-sm text-neutral-800">
            <div>
              <dt className="inline text-neutral-500">من: </dt>
              <dd className="inline">{movement.fromLocationName ?? "—"}</dd>
            </div>
            <div>
              <dt className="inline text-neutral-500">إلى: </dt>
              <dd className="inline">{movement.toLocationName ?? "—"}</dd>
            </div>
            <div>
              <dt className="inline text-neutral-500">نوع الحركة: </dt>
              <dd className="inline">{movement.typeLabel}</dd>
            </div>
          </dl>
        </div>
      </div>

      <div className="mt-6 overflow-x-auto">
        <table className="w-full text-start text-sm">
          <thead className="border-b border-neutral-200 text-xs font-semibold uppercase tracking-wide text-neutral-500">
            <tr>
              <th className="py-2 text-start">المنتج</th>
              <th className="py-2 text-start">SKU</th>
              <th className="py-2 text-start">الكمية المحوّلة</th>
              <th className="py-2 text-start">السابق</th>
              <th className="py-2 text-start">الجديد</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-neutral-100">
            {movement.items.map((item, index) => (
              <tr key={`${item.product.sku}:${item.optionLabel ?? ""}:${index}`}>
                <td className="py-2 text-neutral-900">
                  {item.product.nameAr ?? item.product.name}
                  {item.optionLabel && <span className="block text-xs text-neutral-500">{item.optionLabel}</span>}
                </td>
                <td className="py-2 text-neutral-500">{item.product.sku}</td>
                <td className="py-2 font-medium text-neutral-900">{item.quantity}</td>
                <td className="py-2 text-neutral-700">{item.previousQuantity ?? "—"}</td>
                <td className="py-2 text-neutral-700">{item.newQuantity ?? "—"}</td>
              </tr>
            ))}
          </tbody>
          {movement.items.length > 1 && (
            <tfoot>
              <tr className="border-t border-neutral-200 font-semibold text-neutral-900">
                <td className="py-2" colSpan={2}>
                  الإجمالي
                </td>
                <td className="py-2">{totalQuantity}</td>
                <td className="py-2" colSpan={2} />
              </tr>
            </tfoot>
          )}
        </table>
      </div>

      {movement.note && (
        <div className="mt-6 border-t border-neutral-200 pt-4 text-sm">
          <h2 className="font-semibold text-neutral-500">ملاحظات</h2>
          <p className="mt-1 text-neutral-800">{movement.note}</p>
        </div>
      )}

      <p className="mt-8 text-center text-xs text-neutral-400">
        هذا إشعار تحويل مخزون داخلي وليس فاتورة بيع لعميل
      </p>
    </div>
  );
}
