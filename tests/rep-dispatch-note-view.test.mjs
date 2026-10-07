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

const group = (key, label, quantity, productCount) => ({ key, label, quantity, productCount });
// the Mahmoud-style car: 49 products, 2811 pieces, six printed groups
const MAHMOUD_GROUPS = [
  group("CABLES", "كوابل", 251, 8),
  group("CHARGERS", "شواحن وعضمات شحن", 329, 10),
  group("STICKERS", "ستكرات", 480, 1),
  group("PROTECTORS", "لزقات وحماية", 321, 4),
  group("MAINTENANCE", "صيانة", 100, 1),
  group("OTHER_ACCESSORIES", "باقي الإكسسوارات", 1330, 25),
];
const PRODUCT_ROWS = [
  { productId: "p1", sku: "SECRET-SKU-001", name: "كيبل USB-Type-C تفصيلي", categoryName: "كابلات", quantity: 55, groupKey: "CABLES" },
  { productId: "p2", sku: "SECRET-SKU-002", name: "Adapter iPhone 20W تفصيلي", categoryName: "عظمات شحن", quantity: 83, groupKey: "CHARGERS" },
];
const FIXTURE = {
  reference: "DISP-REP-007-20261007-1005",
  date: "07/10/2026",
  time: "10:05",
  repName: "محمود المندوب",
  employeeCode: "REP-007",
  repPhone: "0599123456",
  carLocationName: "سيارة محمود",
  rows: PRODUCT_ROWS,
  groups: MAHMOUD_GROUPS,
  productCount: 49,
  groupCount: 6,
  totalPieces: 2811,
};
const EMPTY = { ...FIXTURE, rows: [], groups: [], productCount: 0, groupCount: 0, totalPieces: 0 };

const cells = (html, cls) => [...html.matchAll(new RegExp(`<td class="${cls}">([^<]*)</td>`, "g"))].map((m) => m[1]);
const css = (html) => html.match(/<style>([\s\S]*?)<\/style>/)[1];
const size = (sheet, selector) => Number(sheet.match(new RegExp(`${selector.replace(/[.]/g, "\\.")}\\s*\\{[^}]*font-size:\\s*(\\d+)px`))[1]);

test("A/H: the note prints six GROUP rows with their totals — not individual products", () => {
  const html = render(FIXTURE);
  assert.deepEqual(cells(html, "dn-td-name"), MAHMOUD_GROUPS.map((g) => g.label), "fixed business order, exact labels");
  const quantities = cells(html, "dn-td-qty").map(Number);
  assert.deepEqual(quantities, [251, 329, 480, 321, 100, 1330]);
  assert.deepEqual(cells(html, "dn-td-no"), ["1", "2", "3", "4", "5", "6"]);
  assert.equal((html.match(/<tr>/g) || []).length, 1 + 6, "one header row + exactly six body rows");
  // the underlying products handed to the component are NOT printed
  for (const leaked of ["SECRET-SKU-001", "SECRET-SKU-002", "تفصيلي", "USB-Type-C", "Adapter iPhone", "كابلات", "عظمات شحن"]) {
    assert.ok(!html.includes(leaked), `product detail "${leaked}" is not on the sheet`);
  }
  assert.ok(!/<small>/.test(html), "no per-row SKU / category line any more");
});

test("I: the visible group quantity cells add up to the total pieces printed (251+329+480+321+100+1330 = 2811)", () => {
  const html = render(FIXTURE);
  const quantities = cells(html, "dn-td-qty").map(Number);
  const sum = quantities.reduce((a, b) => a + b, 0);
  assert.equal(sum, 2811);
  assert.match(html, /<span>إجمالي عدد القطع<\/span><strong>2811<\/strong>/);
  assert.equal(String(sum), html.match(/dn-total dn-total-main"><span>إجمالي عدد القطع<\/span><strong>(\d+)<\/strong>/)[1]);
});

test("totals: group count is secondary, total pieces is dominant, the real product count is small text — never printed as rows", () => {
  const html = render(FIXTURE);
  const sheet = css(html);
  assert.match(html, /<span>عدد مجموعات الإرسالية<\/span><strong>6<\/strong>/);
  assert.match(html, /<p class="dn-actual">عدد الأصناف الفعلية في السيارة: 49<\/p>/);
  assert.ok(!html.includes("إجمالي عدد الأصناف"), "the old 'total items' wording (which implied 49 printed rows) is gone");
  assert.ok(size(sheet, ".dn-total.dn-total-main strong") >= 48 && size(sheet, ".dn-total.dn-total-main strong") > size(sheet, ".dn-total strong"), "the total pieces number is the biggest figure in the totals");
  assert.ok(size(sheet, ".dn-actual") <= 13, "the actual product count is small secondary text");
});

test("quantity column: very large, bold, high contrast, centered; group names large and readable", () => {
  const html = render(FIXTURE);
  const sheet = css(html);
  assert.ok(size(sheet, ".dn-td-qty") >= 40, "quantity numerals at least 40px");
  assert.ok(size(sheet, ".dn-td-qty") >= size(sheet, ".dn-td-name") * 1.7, "far larger than the group name");
  assert.ok(size(sheet, ".dn-td-name") >= 22, "group names are large too");
  assert.match(sheet, /\.dn-td-qty\s*\{[^}]*font-weight:\s*800/);
  assert.match(sheet, /\.dn-td-qty\s*\{[^}]*text-align:\s*center/);
  assert.match(sheet, /\.dn-td-qty\s*\{[^}]*background:\s*#f0f0f0[^}]*border-inline:\s*2\.5px solid #000/, "shaded column between heavy rules");
  assert.match(sheet, /\.dn-th-qty\s*\{[^}]*background:\s*#000;\s*color:\s*#fff/, "black العدد header");
  assert.match(html, /<th class="dn-th-no">#<\/th><th class="dn-th-name">المجموعة<\/th><th class="dn-th-qty">العدد<\/th>/, "# | المجموعة | العدد");
});

test("F: a group whose total is 0 is not rendered (no 'ستكرات | 0')", () => {
  const withoutStickers = { ...FIXTURE, groups: MAHMOUD_GROUPS.filter((g) => g.key !== "STICKERS"), groupCount: 5, totalPieces: 2331 };
  const html = render(withoutStickers);
  assert.ok(!html.includes("ستكرات"));
  assert.deepEqual(cells(html, "dn-td-qty").map(Number), [251, 329, 321, 100, 1330]);
  assert.deepEqual(cells(html, "dn-td-no"), ["1", "2", "3", "4", "5"], "numbering stays continuous");
});

test("print layout — A4 portrait RTL, repeating header, rows never split, colors preserved", () => {
  const html = render(FIXTURE);
  const sheet = css(html);
  assert.match(html, /class="dn" dir="rtl"/);
  assert.match(sheet, /@page\s*\{\s*size:\s*A4 portrait;\s*margin:\s*12mm/);
  assert.match(sheet, /\.dn-table thead\s*\{\s*display:\s*table-header-group/);
  assert.match(sheet, /\.dn-table tr[^{]*\{\s*break-inside:\s*avoid/);
  assert.match(sheet, /print-color-adjust:\s*exact/);
});

test("header, handover and signature fields; car number / exit time appear ONCE in the handover block", () => {
  const html = render(FIXTURE);
  for (const text of ["Ovi Mobile", "إرسالية مخزون سيارة المندوب", "المرجع:", "DISP-REP-007-20261007-1005", "التاريخ:", "07/10/2026", "وقت الإنشاء:", "10:05", "المندوب:", "محمود المندوب", "رقم الموظف:", "REP-007", "الهاتف:", "0599123456", "السيارة / الموقع:", "سيارة محمود"]) {
    assert.ok(html.includes(text), `header shows "${text}"`);
  }
  for (const label of ["رقم السيارة:", "ساعة الخروج:", "اسم المسلم / مسؤول المخزون:", "توقيع المسلم:", "اسم المندوب المستلم:", "توقيع المندوب:", "التاريخ:"]) assert.ok(html.includes(label), `handover shows "${label}"`);
  assert.ok(html.includes("أقر باستلام الأصناف والكميات المبينة أعلاه."));
  assert.match(html, /اسم المندوب المستلم:<\/span><span class="dn-value">محمود المندوب<\/span>/);
  assert.equal(html.split("رقم السيارة:").length - 1, 1);
  assert.equal(html.split("ساعة الخروج:").length - 1, 1);
  assert.ok(html.indexOf("رقم السيارة:") > html.indexOf('<section class="dn-sign"'));
  assert.ok(html.includes("غير محفوظ في النظام"), "the reference is documented as display-only");
});

test("optional fields are blank lines, never invented values", () => {
  const html = render({ ...FIXTURE, repPhone: null, carLocationName: null });
  assert.match(html, /الهاتف:<\/span><span class="dn-blank">/);
  assert.match(html, /السيارة \/ الموقع:<\/span><span class="dn-blank">/);
  assert.ok(!html.includes("0599123456") && !html.includes("سيارة محمود"));
});

test("G: an empty car keeps the clear message and zero totals, without a quantity cell", () => {
  const html = render(EMPTY);
  assert.ok(html.includes("لا يوجد مخزون حالي في سيارة المندوب"));
  assert.deepEqual(cells(html, "dn-td-qty"), []);
  assert.match(html, /<span>عدد مجموعات الإرسالية<\/span><strong>0<\/strong>/);
  assert.match(html, /<span>إجمالي عدد القطع<\/span><strong>0<\/strong>/);
  assert.ok(html.includes("<thead>") && html.includes("أقر باستلام"), "the form and signature area still print");
});

test("structure — the footnote belongs to the signature block, the info box holds only its four fields", () => {
  const html = render(FIXTURE);
  const infoStart = html.indexOf('<section class="dn-info"');
  const infoEnd = html.indexOf("</section>", infoStart);
  const signStart = html.indexOf('<section class="dn-sign"');
  assert.ok(infoStart > 0 && signStart > infoEnd);
  assert.ok(html.indexOf('class="dn-foot"') > signStart);
  assert.equal((html.slice(infoStart, infoEnd).match(/<div>/g) || []).length, 4);
});

test("nothing technical leaks onto the sheet", () => {
  const html = render(FIXTURE);
  assert.ok(!/productId|cmu[a-z0-9]{10,}|stock|costCents|price|DISPATCH_GROUP/i.test(html.replace(css(html), "")), "no ids, prices or internals in the markup");
});
