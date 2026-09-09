/** Converts a REAL tool result into a native StructuredResponse — the only
 * place in Ovi AI local V1 that turns numbers into UI. Every value rendered
 * here is read directly off the tool result the engine just fetched this
 * turn; nothing is invented, estimated, or carried over from a previous
 * turn's numbers (see engine.ts: context only ever carries entity ids/
 * labels/period/lastIntent, never a stale figure). */

import "server-only";
import { formatCurrencyFromCents } from "@/lib/utils";
import { normalizeSearchText } from "@/lib/ai/normalization";
import type { StructuredResponse, StructuredRow, StructuredSection } from "@/lib/ai/types";
import type { GlobalCaseSummary, InventoryGroupRow, InventoryLocationRow, InventoryTargetSummary, LowStockItem, RepInventoryRow, StockLocationsResult } from "@/lib/ai/tools/inventory";
import type { ProductSalesResult, ResolvedPeriod, SalesSummary, TopSellingProductRow } from "@/lib/ai/tools/sales";
import type { MerchantAccountSummary, MerchantAccountsOverviewResult, MerchantActivityRow } from "@/lib/ai/tools/merchants";
import type { RepPaymentsSummaryResult, RepSalesSummaryResult, RepSummary } from "@/lib/ai/tools/reps";
import type { ProductDetails } from "@/lib/ai/tools/catalog";
import type { RequestedProductScope } from "@/lib/ai/local/product-scope";

const SCOPE_LABEL: Record<RequestedProductScope, string> = { CASE_COVER: "الجفرات/الكفرات", SCREEN_PROTECTOR: "لزقات الحماية" };

const FRIENDLY_ERROR_MESSAGE = "صار خلل مؤقت بالمساعد، جرّب مرة ثانية.";
const READ_ONLY_MESSAGE = "حالياً Ovi AI بقدر يفحص ويحلل البيانات فقط، تنفيذ العمليات مش مفعّل.";

function dateLabel(date: Date | null): string {
  return date ? new Date(date).toLocaleDateString("ar") : "لا يوجد";
}

function locationRows(rows: InventoryLocationRow[]): StructuredRow[] {
  return rows.map((row) => ({ label: row.locationType === "WAREHOUSE" ? row.locationName : (row.repName ?? row.locationName), value: String(row.quantity) }));
}

function locationSection(rows: InventoryLocationRow[]): StructuredSection {
  return { title: "حسب الموقع", rows: locationRows(rows) };
}

/** Narrows an already-fetched inventory group list to ONLY the groups/
 * breakdown rows matching a requested material/variant filter ("طيب الجلد
 * بس" -> "جلد") — a client-side narrowing of REAL data already fetched,
 * never a new/different query. Falls back to the unfiltered list when the
 * filter matches nothing, so a stale/over-eager filter never empties the
 * whole answer. */
function applyMaterialFilter(groups: InventoryGroupRow[], materialFilter: string | null): { groups: InventoryGroupRow[]; filtered: boolean } {
  if (!materialFilter) return { groups, filtered: false };
  const needle = normalizeSearchText(materialFilter);
  const narrowed = groups
    .map((group) => {
      const matchingBreakdown = group.breakdown.filter((entry) => normalizeSearchText(entry.label).includes(needle));
      const groupLabelMatches = normalizeSearchText(group.label).includes(needle) || (group.subLabel ? normalizeSearchText(group.subLabel).includes(needle) : false);
      if (matchingBreakdown.length > 0) return { ...group, breakdown: matchingBreakdown, total: matchingBreakdown.reduce((sum, entry) => sum + entry.quantity, 0) };
      if (groupLabelMatches) return group;
      return null;
    })
    .filter((group): group is InventoryGroupRow => group !== null);
  return narrowed.length > 0 ? { groups: narrowed, filtered: true } : { groups, filtered: false };
}

export function buildInventoryResponse(summary: InventoryTargetSummary, materialFilter: string | null, productScope?: RequestedProductScope | null): StructuredResponse {
  const { groups, filtered } = applyMaterialFilter(summary.groups, materialFilter);
  const sections: StructuredSection[] = groups.map((group) => ({
    title: group.subLabel ? `${group.label} — ${group.subLabel}` : group.label,
    rows: group.breakdown.length > 0 ? group.breakdown.map((entry) => ({ label: entry.label, value: String(entry.quantity) })) : [{ label: "الكمية", value: String(group.total) }],
  }));
  if (summary.byLocation.length > 0) sections.push(locationSection(summary.byLocation));

  // The result passed in here is ALREADY scoped at the source (see
  // getInventorySummary/resolvePhoneModelSummary in tools/inventory.ts) —
  // this only decides the SUMMARY TEXT's own wording, never re-filters
  // anything (unlike applyMaterialFilter above, a genuine client-side
  // narrowing of an unscoped result).
  const total = filtered ? groups.reduce((sum, group) => sum + group.total, 0) : summary.totalQuantity;
  const scopeNote = productScope ? ` (${SCOPE_LABEL[productScope]})` : "";
  const materialNote = filtered ? ` (${materialFilter})` : "";
  const summaryLine = `المتوفر${scopeNote}${materialNote}: ${total}`;

  return {
    kind: "INVENTORY",
    title: summary.label,
    summary: summaryLine,
    metrics: [
      { label: "المستودع", value: String(summary.warehouseQuantity) },
      { label: "سيارات المندوبين", value: String(summary.repCarQuantity) },
    ],
    sections,
  };
}

export function buildLowStockResponse(items: LowStockItem[]): StructuredResponse {
  if (items.length === 0) {
    return { kind: "LOW_STOCK", summary: "لا يوجد أصناف قاربت على النفاد حالياً 👍" };
  }
  return {
    kind: "LOW_STOCK",
    summary: `${items.length} صنف قارب على النفاد`,
    table: { columns: ["الصنف", "الكمية"], rows: items.map((item) => [item.label, item.totalQuantity]) },
  };
}

export function buildStockLocationsResponse(result: StockLocationsResult): StructuredResponse {
  return {
    kind: "STOCK_LOCATIONS",
    title: result.label,
    summary: result.locations.length > 0 ? `${result.label} موجود بـ ${result.locations.length} موقع` : `${result.label} غير موجود بأي موقع حالياً`,
    metrics: [{ label: "المستودع", value: String(result.warehouseQuantity) }],
    sections: result.locations.length > 0 ? [locationSection(result.locations)] : [],
  };
}

export function buildRepInventoryResponse(label: string, warehouseQuantity: number, reps: RepInventoryRow[]): StructuredResponse {
  return {
    kind: "REP_INVENTORY",
    title: label,
    summary: reps.length > 0 ? `${reps.length} مندوب معهم ${label}` : `ما في مندوب معه ${label} بالسيارة حالياً`,
    metrics: [{ label: "المستودع", value: String(warehouseQuantity) }],
    table: reps.length > 0 ? { columns: ["المندوب", "الكمية"], rows: reps.map((rep) => [rep.repName, rep.quantity]) } : undefined,
  };
}

export function buildProductSalesResponse(result: ProductSalesResult): StructuredResponse {
  return {
    kind: "PRODUCT_SALES",
    title: result.label,
    summary: `${result.label} — ${result.period.label}: بيع ${result.quantitySold} قطعة`,
    metrics: [
      { label: "الكمية المباعة", value: String(result.quantitySold) },
      { label: "المبلغ", value: formatCurrencyFromCents(result.amountCents) },
      { label: "عدد الطلبات", value: String(result.orderCount) },
    ],
  };
}

export function buildSalesSummaryResponse(result: SalesSummary): StructuredResponse {
  return {
    kind: "SALES_SUMMARY",
    title: result.period.label,
    summary: `مبيعات ${result.period.label}: ${result.activeSalesCount} عملية بيع`,
    metrics: [
      { label: "عدد المبيعات", value: String(result.activeSalesCount) },
      { label: "إجمالي المبيعات", value: formatCurrencyFromCents(result.salesTotalCents) },
      { label: "عدد الدفعات", value: String(result.paymentsCount) },
      { label: "إجمالي الدفعات", value: formatCurrencyFromCents(result.paymentsTotalCents) },
    ],
  };
}

export function buildTopSellingResponse(period: ResolvedPeriod, rows: TopSellingProductRow[]): StructuredResponse {
  if (rows.length === 0) {
    return { kind: "TOP_SELLING", title: period.label, summary: `لا يوجد مبيعات مسجّلة خلال ${period.label}` };
  }
  return {
    kind: "TOP_SELLING",
    title: period.label,
    summary: `الأكثر مبيعاً — ${period.label}`,
    table: { columns: ["الصنف", "الكمية", "المبلغ"], rows: rows.map((row) => [row.label, row.quantitySold, formatCurrencyFromCents(row.amountCents)]) },
  };
}

export function buildMerchantAccountResponse(result: MerchantAccountSummary): StructuredResponse {
  const rows: StructuredRow[] = [
    { label: "الحالة", value: result.status },
    { label: "المندوب المسؤول", value: result.assignedRepName ?? "لا يوجد" },
    { label: "آخر بيع", value: dateLabel(result.lastSaleAt) },
    { label: "آخر دفعة", value: dateLabel(result.lastPaymentAt) },
  ];
  return {
    kind: "MERCHANT_ACCOUNT",
    title: result.label,
    summary: `الذمة الحالية على ${result.label}: ${formatCurrencyFromCents(result.balanceCents)}`,
    metrics: [{ label: "الذمة الحالية", value: formatCurrencyFromCents(result.balanceCents) }],
    sections: [{ rows }],
  };
}

const ACTIVITY_TYPE_LABEL: Record<MerchantActivityRow["type"], string> = { SALE: "بيع", PAYMENT: "دفعة" };

export function buildMerchantActivityResponse(merchantLabel: string, rows: MerchantActivityRow[]): StructuredResponse {
  if (rows.length === 0) {
    return { kind: "MERCHANT_ACTIVITY", title: merchantLabel, summary: `لا يوجد حركات مسجّلة لـ ${merchantLabel} بعد` };
  }
  return {
    kind: "MERCHANT_ACTIVITY",
    title: merchantLabel,
    summary: `آخر حركات ${merchantLabel}`,
    table: {
      columns: ["النوع", "المرجع", "المبلغ", "التاريخ"],
      rows: rows.map((row) => [ACTIVITY_TYPE_LABEL[row.type] + (row.status === "CANCELLED" ? " (ملغى)" : ""), row.reference, formatCurrencyFromCents(row.amountCents), dateLabel(row.createdAt)]),
    },
  };
}

export function buildRepSummaryResponse(result: RepSummary): StructuredResponse {
  return {
    kind: "REP_SUMMARY",
    title: result.repName,
    summary: `${result.repName} — مخزون سيارته ${result.stock.totalUnits} قطعة، باع ${result.sales.count} عملية ${result.sales.period}`,
    metrics: [
      { label: "مخزون السيارة", value: String(result.stock.totalUnits) },
      { label: "مبيعات " + result.sales.period, value: formatCurrencyFromCents(result.sales.totalCents) },
      { label: "دفعات محصّلة " + result.paymentsCollected.period, value: formatCurrencyFromCents(result.paymentsCollected.totalCents) },
    ],
    sections: [
      {
        rows: [
          { label: "عدد الأصناف المختلفة", value: String(result.stock.distinctProducts) },
          { label: "أصناف قاربت على النفاد", value: String(result.stock.lowStockCount) },
          { label: "عدد عمليات البيع", value: String(result.sales.count) },
          { label: "عدد الدفعات المحصّلة", value: String(result.paymentsCollected.count) },
        ],
      },
    ],
  };
}

export function buildProductPriceResponse(details: ProductDetails): StructuredResponse {
  return {
    kind: "PRODUCT_PRICE",
    title: details.nameAr ?? details.name,
    summary: `سعر ${details.nameAr ?? details.name} — جملة ${formatCurrencyFromCents(details.wholesalePriceCents)} / مفرق ${formatCurrencyFromCents(details.retailPriceCents)}`,
    metrics: [
      { label: "سعر الجملة", value: formatCurrencyFromCents(details.wholesalePriceCents) },
      { label: "سعر المفرق", value: formatCurrencyFromCents(details.retailPriceCents) },
    ],
  };
}

export function buildGlobalCaseCountResponse(summary: GlobalCaseSummary): StructuredResponse {
  return {
    kind: "GLOBAL_CASE_COUNT",
    title: "كل الجفرات/الكفرات",
    summary: `إجمالي الجفرات بالشركة: ${summary.totalQuantity}`,
    metrics: [
      { label: "المستودع", value: String(summary.warehouseQuantity) },
      { label: "سيارات المندوبين", value: String(summary.repCarQuantity) },
      { label: "عدد الأصناف", value: String(summary.distinctProductCount) },
    ],
  };
}

export function buildGlobalCaseInventoryResponse(summary: GlobalCaseSummary): StructuredResponse {
  return {
    kind: "GLOBAL_CASE_INVENTORY",
    title: "كل الجفرات/الكفرات",
    summary: `إجمالي الجفرات بالشركة: ${summary.totalQuantity}`,
    metrics: [
      { label: "المستودع", value: String(summary.warehouseQuantity) },
      { label: "سيارات المندوبين", value: String(summary.repCarQuantity) },
      { label: "عدد الأصناف", value: String(summary.distinctProductCount) },
    ],
    table: summary.topProducts.length > 0 ? { columns: ["الصنف", "الكمية"], rows: summary.topProducts.map((product) => [product.label, product.quantity]) } : undefined,
  };
}

export function buildRepPaymentsSummaryResponse(result: RepPaymentsSummaryResult): StructuredResponse {
  if (result.reps.length === 0) {
    return { kind: "REP_PAYMENTS_SUMMARY", title: `دفعات المندوبين — ${result.period.label}`, summary: `لا يوجد دفعات مسجّلة من المندوبين خلال ${result.period.label}` };
  }
  return {
    kind: "REP_PAYMENTS_SUMMARY",
    title: `دفعات المندوبين — ${result.period.label}`,
    summary: `إجمالي المقبوض: ${formatCurrencyFromCents(result.totalAmountCents)} — ${result.totalPaymentsCount} دفعة`,
    metrics: [
      { label: "إجمالي المقبوض", value: formatCurrencyFromCents(result.totalAmountCents) },
      { label: "عدد الدفعات", value: String(result.totalPaymentsCount) },
    ],
    table: { columns: ["المندوب", "المبلغ", "عدد الدفعات"], rows: result.reps.map((rep) => [rep.repName, formatCurrencyFromCents(rep.amountCents), rep.paymentsCount]) },
  };
}

/** "مين اكتر مندوب باع اليوم؟"/"مبيعات المندوبين هالشهر" — company-wide
 * sales grouped/ranked by rep (see getRepSalesSummary, tools/reps.ts, for
 * the exact bounded query plan and terminal-sale/business-time semantics).
 * The numbered ranking table below reads directly off `result.reps`, which
 * getRepSalesSummary already sorts by amountCents descending — never a
 * second, separate sort here. */
export function buildRepSalesSummaryResponse(result: RepSalesSummaryResult): StructuredResponse {
  if (result.reps.length === 0) {
    return { kind: "REP_SALES_SUMMARY", title: `مبيعات المندوبين — ${result.period.label}`, summary: `لا توجد مبيعات مسجّلة من المندوبين خلال ${result.period.label}` };
  }
  return {
    kind: "REP_SALES_SUMMARY",
    title: `مبيعات المندوبين — ${result.period.label}`,
    summary: `إجمالي المبيعات: ${formatCurrencyFromCents(result.totalAmountCents)} — ${result.totalQuantitySold} قطعة — ${result.totalOrderCount} طلب`,
    metrics: [
      { label: "إجمالي المبيعات", value: formatCurrencyFromCents(result.totalAmountCents) },
      { label: "إجمالي القطع", value: String(result.totalQuantitySold) },
      { label: "عدد الطلبات", value: String(result.totalOrderCount) },
    ],
    table: { columns: ["المندوب", "المبلغ", "القطع", "الطلبات"], rows: result.reps.map((rep) => [rep.repName, formatCurrencyFromCents(rep.amountCents), rep.quantitySold, rep.orderCount]) },
  };
}

export function buildMerchantAccountsOverviewResponse(result: MerchantAccountsOverviewResult): StructuredResponse {
  return {
    kind: "MERCHANT_ACCOUNTS_OVERVIEW",
    title: "حسابات التجار",
    summary: `إجمالي الذمم: ${formatCurrencyFromCents(result.totalOutstandingCents)} — ${result.merchantsWithBalanceCount} تاجر عليهم رصيد`,
    metrics: [
      { label: "إجمالي الذمم", value: formatCurrencyFromCents(result.totalOutstandingCents) },
      { label: "عدد التجار عليهم رصيد", value: String(result.merchantsWithBalanceCount) },
    ],
    table: result.topMerchants.length > 0 ? { columns: ["التاجر", "الذمة"], rows: result.topMerchants.map((merchant) => [merchant.label, formatCurrencyFromCents(merchant.balanceCents)]) } : undefined,
  };
}

export function buildReadOnlyResponse(): StructuredResponse {
  return { kind: "READ_ONLY", summary: READ_ONLY_MESSAGE };
}

export function buildConversationalResponse(): StructuredResponse {
  return { kind: "TEXT", summary: "أهلاً! اسأل عن المخزون، الأصناف، التجار، أو المبيعات." };
}

export function buildGeneralHelpResponse(): StructuredResponse {
  return { kind: "TEXT", summary: "حدد أكثر شو حاب تعرف." };
}

export function buildClarificationResponse(hasCandidates: boolean): StructuredResponse {
  return { kind: "CLARIFICATION", summary: hasCandidates ? "لقيت أكثر من احتمال، أي واحد تقصد؟" : "ما فهمت بالضبط، ممكن تحدد أكثر؟" };
}

export function buildNoMatchResponse(hasCandidates: boolean): StructuredResponse {
  return { kind: "NO_MATCH", summary: hasCandidates ? "ما لقيت تطابق واضح، أقرب الموجود عندنا:" : "ما لقيت نتيجة مطابقة، جرّب صياغة ثانية." };
}

export function buildErrorResponse(): StructuredResponse {
  return { kind: "ERROR", summary: FRIENDLY_ERROR_MESSAGE };
}
