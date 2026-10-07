import type { RepDispatchNoteData } from "@/lib/rep-dispatch-note";

/** Server-renderable, print-first "إرسالية مخزون سيارة المندوب" — a plain
 * black-and-white warehouse hand-over form (A4 portrait, RTL), not an app
 * screen. It is a SUMMARY: one row per business group (كوابل، شواحن، …) with
 * its total quantity, never one row per product. The "العدد" column is by far
 * the heaviest thing in the table (very large bold numerals on a shaded,
 * ruled column), the group name is the only other primary text. All numbers come from RepDispatchNoteData —
 * nothing is recomputed here, so the totals can never disagree with the
 * quantity cells above them. Read-only: this component renders, nothing
 * else. */
const DISPATCH_NOTE_CSS = `
.dn { background: #fff; color: #000; font-family: inherit; direction: rtl; max-width: 794px; margin: 0 auto; padding: 28px 32px; border: 1px solid #d4d4d4; line-height: 1.35; }
.dn * { box-sizing: border-box; }
.dn h1 { margin: 2px 0 0; font-size: 24px; font-weight: 800; }
.dn-head { display: flex; justify-content: space-between; align-items: flex-start; gap: 16px; border: 2px solid #000; padding: 10px 16px; }
.dn-logo { font-size: 15px; font-weight: 800; letter-spacing: 2px; text-transform: uppercase; }
.dn-ref { text-align: end; font-size: 13px; line-height: 1.7; }
.dn-ref b { font-weight: 800; }
.dn-info { display: grid; grid-template-columns: 1fr 1fr; border: 2px solid #000; border-top: 0; }
.dn-info > div { display: flex; align-items: baseline; gap: 8px; padding: 7px 14px; border-bottom: 1px solid #000; font-size: 14px; min-height: 30px; }
.dn-info > div:nth-child(odd) { border-inline-start: 0; }
.dn-info > div:nth-child(even) { border-inline-end: 1px solid #000; }
.dn-info > div:nth-last-child(-n+2) { border-bottom: 0; }
.dn-label { color: #333; white-space: nowrap; font-weight: 600; }
.dn-value { font-weight: 700; }
.dn-blank { flex: 1; border-bottom: 1px solid #000; min-width: 90px; height: 18px; }
.dn-table { width: 100%; border-collapse: collapse; margin-top: 14px; border: 2.5px solid #000; }
.dn-table th, .dn-table td { border: 1px solid #000; }
.dn-table thead th { background: #e5e5e5; font-size: 16px; font-weight: 800; padding: 8px 10px; text-align: center; }
.dn-table thead th.dn-th-qty { background: #000; color: #fff; font-size: 22px; width: 190px; }
.dn-table thead th.dn-th-no { width: 52px; }
.dn-table thead th.dn-th-name { text-align: start; }
.dn-table td { padding: 6px 14px; vertical-align: middle; }
.dn-td-no { text-align: center; font-size: 18px; font-weight: 700; color: #222; }
.dn-td-name { font-size: 22px; font-weight: 800; }
.dn-td-qty { text-align: center; font-size: 40px; font-weight: 800; line-height: 1.05; font-variant-numeric: tabular-nums; background: #f0f0f0; border-inline: 2.5px solid #000; padding: 3px 8px; }
.dn-empty { text-align: center; padding: 28px 10px; font-size: 18px; font-weight: 700; }
.dn-totals { display: grid; grid-template-columns: 1fr 1.5fr; gap: 14px; margin-top: 14px; }
.dn-total { border: 2.5px solid #000; padding: 8px 16px; display: flex; align-items: center; justify-content: space-between; gap: 10px; }
.dn-total span { font-size: 16px; font-weight: 700; }
.dn-total strong { font-size: 30px; font-weight: 800; font-variant-numeric: tabular-nums; }
.dn-total.dn-total-main { border-width: 3.5px; padding: 8px 18px; }
.dn-total.dn-total-main span { font-size: 20px; font-weight: 800; }
.dn-total.dn-total-main strong { font-size: 48px; }
.dn-actual { margin: 6px 2px 0; font-size: 12px; color: #444; }
.dn-sign { margin-top: 12px; border: 2px solid #000; padding: 10px 16px; }
.dn-ack { font-size: 14px; font-weight: 700; margin: 0 0 10px; }
.dn-sign-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 6px 28px; }
.dn-sign-grid > div { display: flex; align-items: baseline; gap: 8px; font-size: 14px; min-height: 26px; }
.dn-sign-title { grid-column: 1 / -1; font-size: 14px; font-weight: 800; border-bottom: 1px solid #000; padding-bottom: 2px; margin-top: 4px; }
.dn-foot { margin: 8px 0 0; text-align: center; font-size: 11px; color: #555; }
@media print {
  @page { size: A4 portrait; margin: 12mm; }
  html, body { background: #fff !important; }
  .dn { border: 0; padding: 0; max-width: none; margin: 0; }
  .dn, .dn * { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  .dn-table thead { display: table-header-group; }
  .dn-table tbody { display: table-row-group; }
  .dn-table tr, .dn-head, .dn-info, .dn-totals, .dn-actual, .dn-sign { break-inside: avoid; page-break-inside: avoid; }
}
`;

export function RepDispatchNoteView({ data }: { data: RepDispatchNoteData }) {
  return (
    <div className="dn" dir="rtl">
      <style>{DISPATCH_NOTE_CSS}</style>

      <header className="dn-head">
        <div>
          <div className="dn-logo">Ovi Mobile</div>
          <h1>إرسالية مخزون سيارة المندوب</h1>
        </div>
        <div className="dn-ref">
          <div>
            المرجع: <b dir="ltr">{data.reference}</b>
          </div>
          <div>
            التاريخ: <b>{data.date}</b>
          </div>
          <div>
            وقت الإنشاء: <b>{data.time}</b>
          </div>
        </div>
      </header>

      <section className="dn-info" aria-label="بيانات الإرسالية">
        <div>
          <span className="dn-label">المندوب:</span>
          <span className="dn-value">{data.repName}</span>
        </div>
        <div>
          <span className="dn-label">رقم الموظف:</span>
          <span className="dn-value" dir="ltr">{data.employeeCode}</span>
        </div>
        <div>
          <span className="dn-label">الهاتف:</span>
          {data.repPhone ? <span className="dn-value" dir="ltr">{data.repPhone}</span> : <span className="dn-blank" />}
        </div>
        <div>
          <span className="dn-label">السيارة / الموقع:</span>
          {data.carLocationName ? <span className="dn-value">{data.carLocationName}</span> : <span className="dn-blank" />}
        </div>
      </section>

      <table className="dn-table">
        <thead>
          <tr>
            <th className="dn-th-no">#</th>
            <th className="dn-th-name">المجموعة</th>
            <th className="dn-th-qty">العدد</th>
          </tr>
        </thead>
        <tbody>
          {data.groups.length === 0 ? (
            <tr>
              <td className="dn-empty" colSpan={3}>
                لا يوجد مخزون حالي في سيارة المندوب
              </td>
            </tr>
          ) : (
            data.groups.map((group, index) => (
              <tr key={group.key}>
                <td className="dn-td-no">{index + 1}</td>
                <td className="dn-td-name">{group.label}</td>
                <td className="dn-td-qty">{group.quantity}</td>
              </tr>
            ))
          )}
        </tbody>
      </table>

      <div className="dn-totals">
        <div className="dn-total">
          <span>عدد مجموعات الإرسالية</span>
          <strong>{data.groupCount}</strong>
        </div>
        <div className="dn-total dn-total-main">
          <span>إجمالي عدد القطع</span>
          <strong>{data.totalPieces}</strong>
        </div>
      </div>
      <p className="dn-actual">عدد الأصناف الفعلية في السيارة: {data.productCount}</p>

      <section className="dn-sign" aria-label="التسليم والتوقيع">
        <p className="dn-ack">أقر باستلام الأصناف والكميات المبينة أعلاه.</p>
        <div className="dn-sign-grid">
          <div>
            <span className="dn-label">رقم السيارة:</span>
            <span className="dn-blank" />
          </div>
          <div>
            <span className="dn-label">ساعة الخروج:</span>
            <span className="dn-blank" />
          </div>

          <div className="dn-sign-title">المسلِّم</div>
          <div>
            <span className="dn-label">اسم المسلم / مسؤول المخزون:</span>
            <span className="dn-blank" />
          </div>
          <div>
            <span className="dn-label">توقيع المسلم:</span>
            <span className="dn-blank" />
          </div>

          <div className="dn-sign-title">المندوب المستلم</div>
          <div>
            <span className="dn-label">اسم المندوب المستلم:</span>
            <span className="dn-value">{data.repName}</span>
          </div>
          <div>
            <span className="dn-label">توقيع المندوب:</span>
            <span className="dn-blank" />
          </div>
          <div>
            <span className="dn-label">التاريخ:</span>
            <span className="dn-blank" />
          </div>
        </div>
        <p className="dn-foot">وثيقة تسليم داخلية — ليست فاتورة بيع. المرجع للعرض فقط وغير محفوظ في النظام.</p>
      </section>
    </div>
  );
}
