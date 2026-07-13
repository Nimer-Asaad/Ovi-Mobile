import { getStockRequestStatusLabel, getRequestLineStateLabel } from "@/lib/rep-stock-request-labels";

export interface RepStockRequestPrintItem {
  id: string;
  productLabel: string;
  sku: string;
  requestedQuantity: number;
  approvedQuantity: number | null;
}

export interface RepStockRequestPrintData {
  id: string;
  requestNumber: string | null;
  status: string;
  createdAt: Date;
  repName: string;
  destinationLocationName: string;
  repNote: string | null;
  adminNote: string | null;
  items: RepStockRequestPrintItem[];
}

/** Pure, server-renderable preparation/transfer document — styled as a
 * literal white paper document like the Phase 25/26 invoices, but with its
 * own distinct wording ("إذن تجهيز مخزون سيارة") so it is never confused
 * with a customer sales invoice. Read-only: shows requested vs approved
 * quantities exactly as saved, never recalculates anything. */
export function RepStockRequestPrintView({ request }: { request: RepStockRequestPrintData }) {
  return (
    <div className="mx-auto max-w-3xl rounded-card border border-neutral-200 bg-white p-8 text-neutral-900 shadow-sm print:m-0 print:max-w-none print:border-0 print:shadow-none">
      <div className="flex flex-wrap items-start justify-between gap-4 border-b border-neutral-200 pb-6">
        <div>
          <h1 className="text-2xl font-bold text-neutral-900">Ovi Mobile</h1>
          <p className="mt-1 text-sm text-neutral-500">إذن تجهيز مخزون سيارة</p>
        </div>
        <div className="text-end text-sm text-neutral-600">
          <p>
            رقم الطلب: <span className="font-semibold text-neutral-900">{request.requestNumber ?? request.id}</span>
          </p>
          <p>التاريخ: {new Date(request.createdAt).toLocaleDateString("ar")}</p>
          <p>الحالة: {getStockRequestStatusLabel(request.status)}</p>
        </div>
      </div>

      <div className="mt-6 grid grid-cols-1 gap-6 sm:grid-cols-2">
        <div>
          <h2 className="text-sm font-semibold text-neutral-500">بيانات المندوب</h2>
          <dl className="mt-2 flex flex-col gap-1 text-sm text-neutral-800">
            <div>
              <dt className="inline text-neutral-500">المندوب: </dt>
              <dd className="inline">{request.repName}</dd>
            </div>
          </dl>
        </div>

        <div>
          <h2 className="text-sm font-semibold text-neutral-500">بيانات النقل</h2>
          <dl className="mt-2 flex flex-col gap-1 text-sm text-neutral-800">
            <div>
              <dt className="inline text-neutral-500">من: </dt>
              <dd className="inline">Main Warehouse</dd>
            </div>
            <div>
              <dt className="inline text-neutral-500">إلى: </dt>
              <dd className="inline">{request.destinationLocationName}</dd>
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
              <th className="py-2 text-start">الكمية المطلوبة</th>
              <th className="py-2 text-start">الكمية الموافق عليها</th>
              <th className="py-2 text-start">الحالة</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-neutral-100">
            {request.items.map((item) => (
              <tr key={item.id}>
                <td className="py-2 text-neutral-900">{item.productLabel}</td>
                <td className="py-2 text-neutral-500">{item.sku}</td>
                <td className="py-2 text-neutral-700">{item.requestedQuantity}</td>
                <td className="py-2 font-medium text-neutral-900">{item.approvedQuantity ?? "—"}</td>
                <td className="py-2 text-neutral-700">
                  {getRequestLineStateLabel(item.requestedQuantity, item.approvedQuantity)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {(request.repNote || request.adminNote) && (
        <div className="mt-6 grid grid-cols-1 gap-4 border-t border-neutral-200 pt-4 text-sm sm:grid-cols-2">
          {request.repNote && (
            <div>
              <h2 className="font-semibold text-neutral-500">ملاحظة المندوب</h2>
              <p className="mt-1 text-neutral-800">{request.repNote}</p>
            </div>
          )}
          {request.adminNote && (
            <div>
              <h2 className="font-semibold text-neutral-500">ملاحظة المدير</h2>
              <p className="mt-1 text-neutral-800">{request.adminNote}</p>
            </div>
          )}
        </div>
      )}

      <div className="mt-10 grid grid-cols-1 gap-8 text-sm sm:grid-cols-2">
        <div>
          <p className="text-neutral-500">توقيع المسؤول</p>
          <div className="mt-8 border-t border-neutral-300" />
        </div>
        <div>
          <p className="text-neutral-500">توقيع المندوب عند الاستلام</p>
          <div className="mt-8 border-t border-neutral-300" />
        </div>
      </div>

      <p className="mt-8 text-center text-xs text-neutral-400">
        هذا إذن تجهيز مخزون داخلي وليس فاتورة بيع لعميل
      </p>
    </div>
  );
}
