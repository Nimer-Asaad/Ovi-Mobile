import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import test from "node:test";
import ts from "typescript";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const nodeRequire = createRequire(import.meta.url);

// Loads the REAL RepDispatchNoteView.tsx (the same file the page renders) and
// renders it to static HTML — type-only imports are erased, so no server-only
// module is pulled in.
function loadView() {
  const source = readFileSync(resolve(root, "src/components/reps/RepDispatchNoteView.tsx"), "utf8");
  const code = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
  }).outputText;
  const loaded = { exports: {} };
  new Function("require", "module", "exports", code)((id) => nodeRequire(id), loaded, loaded.exports);
  return loaded.exports.RepDispatchNoteView;
}

const { renderToStaticMarkup } = nodeRequire("react-dom/server");
const { createElement } = nodeRequire("react");
const View = loadView();
const render = (data) => renderToStaticMarkup(createElement(View, { data }));

const row = (n, sku, name, quantity, categoryName = null) => ({ productId: `p${n}`, sku, name, categoryName, quantity });
const FIXTURE = {
  reference: "DISP-EMP-07-20261007-1005",
  date: "07/10/2026",
  time: "10:05",
  repName: "أحمد المندوب",
  employeeCode: "EMP-07",
  repPhone: "0599123456",
  carLocationName: "سيارة أحمد",
  rows: [row(1, "OVI-A", "كفر آيفون", 26, "إكسسوارات"), row(2, "OVI-B", "شاحن سريع", 42, "إكسسوارات"), row(3, "OVI-C", "كيبل USB", 65, "شواحن"), row(4, "OVI-D", "زجاج حماية", 23), row(5, "OVI-E", "سماعة", 35)],
  itemCount: 5,
  totalPieces: 191,
};
const EMPTY = { ...FIXTURE, rows: [], itemCount: 0, totalPieces: 0 };

const cells = (html, cls) => [...html.matchAll(new RegExp(`<td class="${cls}">([^<]*)</td>`, "g"))].map((m) => m[1]);
const css = (html) => html.match(/<style>([\s\S]*?)<\/style>/)[1];

test("1-3: the real fixture renders A26 B42 C65 D23 E35 — every quantity cell exact, total = their sum", () => {
  const html = render(FIXTURE);
  const quantities = cells(html, "dn-td-qty").map(Number);
  assert.deepEqual(quantities, [26, 42, 65, 23, 35]);
  assert.equal(quantities.reduce((a, b) => a + b, 0), 191, "the visible quantity cells add up to 191");
  assert.match(html, /<span>إجمالي عدد الأصناف<\/span><strong>5<\/strong>/);
  assert.match(html, /<span>إجمالي عدد القطع<\/span><strong>191<\/strong>/);
  assert.equal(quantities.length, FIXTURE.itemCount, "one row per counted item");
  assert.deepEqual(cells(html, "dn-td-no"), ["1", "2", "3", "4", "5"], "rows are numbered");
});

test("4: the quantity column is the strongest thing in the table", () => {
  const sheet = css(render(FIXTURE));
  const size = (selector) => Number(sheet.match(new RegExp(`${selector.replace(/[.]/g, "\\.")}\\s*\\{[^}]*font-size:\\s*(\\d+)px`))[1]);
  const weight = (selector) => Number(sheet.match(new RegExp(`${selector.replace(/[.]/g, "\\.")}\\s*\\{[^}]*font-weight:\\s*(\\d+)`))[1]);
  assert.ok(size(".dn-td-qty") >= 28, "quantity numerals are at least 28px");
  assert.ok(size(".dn-td-qty") >= size(".dn-td-name") * 1.7, "far larger than the product name");
  assert.ok(weight(".dn-td-qty") >= 800, "heaviest weight");
  assert.match(sheet, /\.dn-td-qty\s*\{[^}]*text-align:\s*center/, "centered");
  assert.match(sheet, /\.dn-td-qty\s*\{[^}]*background:\s*#f0f0f0[^}]*border-inline:\s*2\.5px solid #000/, "a shaded column between heavy rules");
  assert.match(sheet, /\.dn-th-qty\s*\{[^}]*background:\s*#000;\s*color:\s*#fff[^}]*width:\s*150px/, "the العدد header is black-on-white-text and a wide, heavy column");
  assert.match(render(FIXTURE), /<th class="dn-th-qty">العدد<\/th>/);
  assert.ok(size(".dn-td-name small") <= 11, "SKU/category metadata is small");
});

test("5: print layout — A4 portrait RTL, repeating header, rows never split, colors preserved", () => {
  const html = render(FIXTURE);
  const sheet = css(html);
  assert.match(html, /class="dn" dir="rtl"/);
  assert.match(sheet, /@page\s*\{\s*size:\s*A4 portrait;\s*margin:\s*12mm/);
  assert.match(sheet, /\.dn-table thead\s*\{\s*display:\s*table-header-group/, "the table header repeats on every printed page");
  assert.match(sheet, /\.dn-table tr[^{]*\{\s*break-inside:\s*avoid/, "a row is never split across pages");
  assert.match(sheet, /print-color-adjust:\s*exact/, "the shaded quantity column and black header print");
  assert.match(html, /<thead>/);
});

test("6-7: header, handover and signature fields", () => {
  const html = render(FIXTURE);
  for (const text of ["Ovi Mobile", "إرسالية مخزون سيارة المندوب", "المرجع:", "DISP-EMP-07-20261007-1005", "التاريخ:", "07/10/2026", "وقت الإنشاء:", "10:05", "المندوب:", "أحمد المندوب", "رقم الموظف:", "EMP-07", "الهاتف:", "0599123456", "السيارة / الموقع:", "سيارة أحمد"]) {
    assert.ok(html.includes(text), `header shows "${text}"`);
  }
  for (const label of ["رقم السيارة:", "ساعة الخروج:", "اسم المسلم / مسؤول المخزون:", "توقيع المسلم:", "اسم المندوب المستلم:", "توقيع المندوب:", "التاريخ:"]) {
    assert.ok(html.includes(label), `handover shows "${label}"`);
  }
  assert.ok(html.includes("أقر باستلام الأصناف والكميات المبينة أعلاه."), "acknowledgment text");
  assert.match(html, /اسم المندوب المستلم:<\/span><span class="dn-value">أحمد المندوب<\/span>/, "the receiving rep's real name is printed");
  assert.match(html, /رقم السيارة:<\/span><span class="dn-blank">/, "car number is a blank printable line (not stored anywhere)");
  assert.ok(html.includes("غير محفوظ في النظام"), "the reference is documented as display-only");
});

test("8: optional fields are blank lines, never invented values", () => {
  const html = render({ ...FIXTURE, repPhone: null, carLocationName: null });
  assert.match(html, /الهاتف:<\/span><span class="dn-blank">/);
  assert.match(html, /السيارة \/ الموقع:<\/span><span class="dn-blank">/);
  assert.ok(!html.includes("0599123456") && !html.includes("سيارة أحمد"));
});

test("9: an empty car renders the clear message and zero totals without a quantity cell", () => {
  const html = render(EMPTY);
  assert.ok(html.includes("لا يوجد مخزون حالي في سيارة المندوب"));
  assert.deepEqual(cells(html, "dn-td-qty"), []);
  assert.match(html, /<span>إجمالي عدد الأصناف<\/span><strong>0<\/strong>/);
  assert.match(html, /<span>إجمالي عدد القطع<\/span><strong>0<\/strong>/);
  assert.ok(html.includes("<thead>") && html.includes("أقر باستلام"), "the form and signature area still print");
});

test("10: nothing technical leaks onto the sheet", () => {
  const html = render(FIXTURE);
  assert.ok(!/p[1-5]\b|productId|cmu[a-z0-9]{10,}|stock|quantity=|costCents|price/i.test(html.replace(css(html), "")), "no ids, prices or internals in the markup");
  assert.ok(html.includes("OVI-A") && html.includes("إكسسوارات"), "only the small SKU / category line");
});

test("11: structure — the footnote belongs to the signature block, the info box holds only its four fields", () => {
  const html = render(FIXTURE);
  const infoStart = html.indexOf('<section class="dn-info"');
  const infoEnd = html.indexOf("</section>", infoStart);
  const signStart = html.indexOf('<section class="dn-sign"');
  const footAt = html.indexOf('class="dn-foot"');
  assert.ok(infoStart > 0 && signStart > infoEnd, "info box comes first, signature block after the table");
  assert.ok(footAt > signStart, "the footnote is inside/after the signature block, never inside the info box");
  assert.equal((html.slice(infoStart, infoEnd).match(/<div>/g) || []).length, 4, "the info box has exactly its four fields (rep, code, phone, car)");
});

test("12: رقم السيارة / ساعة الخروج appear ONCE, in the handover block only", () => {
  const html = render(FIXTURE);
  assert.equal(html.split("رقم السيارة:").length - 1, 1);
  assert.equal(html.split("ساعة الخروج:").length - 1, 1);
  assert.ok(html.indexOf("رقم السيارة:") > html.indexOf('<section class="dn-sign"'), "inside the signature/handover section");
});

test("13: compact rows — one line per item, quantity still the dominant element", () => {
  const sheet = css(render(FIXTURE));
  assert.match(sheet, /\.dn-table td\s*\{\s*padding:\s*3px 10px/, "tight cell padding");
  assert.match(sheet, /\.dn-td-name small\s*\{\s*display:\s*inline/, "SKU/category sit on the same line as the name");
  assert.match(sheet, /\.dn-td-qty\s*\{[^}]*font-size:\s*30px[^}]*font-weight:\s*800/, "30px / 800 quantity numerals");
});
