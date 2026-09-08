import "server-only";
import { z } from "zod";
import { searchCatalogCandidates, getProductDetails } from "@/lib/ai/tools/catalog";
import { getInventorySummary, getRepInventoryBreakdown, getLowStockItems, getStockLocationsForItem } from "@/lib/ai/tools/inventory";
import { getSalesSummary, getProductSales, getTopSellingProducts } from "@/lib/ai/tools/sales";
import { searchMerchants, getMerchantAccountSummary, getMerchantRecentActivity } from "@/lib/ai/tools/merchants";
import { searchReps, getRepSummary } from "@/lib/ai/tools/reps";

/** The complete, closed set of read-only tools Ovi AI may call. This is
 * ALSO the entire attack surface for tool-driven mutation — there is no
 * "execute query"/raw-SQL/generic-write tool anywhere in this list, and
 * there never will be one added casually: every entry here is a typed,
 * validated, server-only wrapper around a canonical Ovi helper. See the
 * feature report's "no arbitrary SQL tool" / "no DB writes" confirmations. */

const targetTypeSchema = z.enum(["PRODUCT", "PHONE_MODEL"]);

const periodSchema = z.union([
  z.object({ type: z.enum(["TODAY", "YESTERDAY", "THIS_WEEK", "THIS_MONTH"]) }),
  z.object({
    type: z.literal("CUSTOM"),
    fromIso: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "YYYY-MM-DD"),
    toIso: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "YYYY-MM-DD"),
  }),
]);

const searchCatalogCandidatesSchema = z.object({
  query: z.string().min(1).max(200),
  limit: z.number().int().min(1).max(12).optional(),
});

const targetSchema = z.object({
  targetType: targetTypeSchema,
  targetId: z.string().min(1).max(100),
});

const getProductDetailsSchema = z.object({ productId: z.string().min(1).max(100) });

const getLowStockItemsSchema = z.object({ limit: z.number().int().min(1).max(20).optional() });

const getSalesSummarySchema = z.object({ period: periodSchema });

const getProductSalesSchema = z.object({ targetType: targetTypeSchema, targetId: z.string().min(1).max(100), period: periodSchema });

const getTopSellingProductsSchema = z.object({ period: periodSchema, limit: z.number().int().min(1).max(15).optional() });

const searchMerchantsSchema = z.object({ query: z.string().min(1).max(200), limit: z.number().int().min(1).max(12).optional() });

const getMerchantAccountSummarySchema = z.object({ merchantId: z.string().min(1).max(100) });

const getMerchantRecentActivitySchema = z.object({ merchantId: z.string().min(1).max(100), limit: z.number().int().min(1).max(20).optional() });

const searchRepsSchema = z.object({ query: z.string().min(1).max(200), limit: z.number().int().min(1).max(10).optional() });

const getRepSummarySchema = z.object({ repId: z.string().min(1).max(100), period: periodSchema.optional() });

/** One entry per callable tool — `execute` always receives ALREADY-VALIDATED
 * args (parsed through `schema` first, see orchestrator.ts) and always
 * returns a small, bounded, JSON-serializable object; never a raw Prisma
 * row, never an unbounded array. */
export interface ToolDefinition<Args> {
  description: string;
  schema: z.ZodType<Args>;
  execute: (args: Args) => Promise<unknown>;
}

export const OVI_AI_TOOLS = {
  search_catalog_candidates: {
    description:
      "ابحث عن أصناف/موديلات هواتف حقيقية مطابقة لنص المستخدم. استخدمها أولاً لأي سؤال عن منتج أو جهاز قبل أي أداة أخرى — لا تخمّن أبداً targetId.",
    schema: searchCatalogCandidatesSchema,
    execute: async ({ query, limit }) => searchCatalogCandidates(query, limit),
  } satisfies ToolDefinition<z.infer<typeof searchCatalogCandidatesSchema>>,

  get_inventory_summary: {
    description: "أرجع المخزون الفعلي الكامل (المستودع + سيارات المندوبين + التفصيل حسب النوع/اللون) لصنف أو موديل محدد مسبقاً عبر search_catalog_candidates.",
    schema: targetSchema,
    execute: async ({ targetType, targetId }) => getInventorySummary(targetType, targetId),
  } satisfies ToolDefinition<z.infer<typeof targetSchema>>,

  get_rep_inventory_breakdown: {
    description: "أرجع كمية صنف/موديل محدد لدى كل مندوب على حدة (سيارته)، بالإضافة إلى كمية المستودع.",
    schema: targetSchema,
    execute: async ({ targetType, targetId }) => getRepInventoryBreakdown(targetType, targetId),
  } satisfies ToolDefinition<z.infer<typeof targetSchema>>,

  get_low_stock_items: {
    description: "أرجع قائمة محدودة بالأصناف النشطة التي أوشك مخزونها الكلي (كل الشركة) على النفاد.",
    schema: getLowStockItemsSchema,
    execute: async ({ limit }) => getLowStockItems(limit),
  } satisfies ToolDefinition<z.infer<typeof getLowStockItemsSchema>>,

  get_stock_locations_for_item: {
    description: "أرجع أين يوجد صنف/موديل فعلياً — كمية المستودع وكل سيارة مندوب على حدة.",
    schema: targetSchema,
    execute: async ({ targetType, targetId }) => getStockLocationsForItem(targetType, targetId),
  } satisfies ToolDefinition<z.infer<typeof targetSchema>>,

  get_product_details: {
    description: "أرجع تفاصيل صنف حقيقي محدد: السعر (جملة/مفرق)، الفئة، العلامة، حالة التفعيل، والأجهزة المتوافقة إن وجدت.",
    schema: getProductDetailsSchema,
    execute: async ({ productId }) => getProductDetails(productId),
  } satisfies ToolDefinition<z.infer<typeof getProductDetailsSchema>>,

  get_sales_summary: {
    description: "أرجع إجمالي المبيعات والدفعات (عدد ومبلغ) للشركة كاملة خلال فترة زمنية.",
    schema: getSalesSummarySchema,
    execute: async ({ period }) => getSalesSummary(period),
  } satisfies ToolDefinition<z.infer<typeof getSalesSummarySchema>>,

  get_product_sales: {
    description: "أرجع كمية ومبلغ مبيعات صنف/موديل محدد مسبقاً خلال فترة زمنية.",
    schema: getProductSalesSchema,
    execute: async ({ targetType, targetId, period }) => getProductSales(targetType, targetId, period),
  } satisfies ToolDefinition<z.infer<typeof getProductSalesSchema>>,

  get_top_selling_products: {
    description: "أرجع قائمة محدودة بأكثر الأصناف مبيعاً خلال فترة زمنية.",
    schema: getTopSellingProductsSchema,
    execute: async ({ period, limit }) => getTopSellingProducts(period, limit),
  } satisfies ToolDefinition<z.infer<typeof getTopSellingProductsSchema>>,

  search_merchants: {
    description: "ابحث عن تاجر حقيقي بالاسم أو رقم الهاتف. استخدمها قبل أي سؤال عن ذمة/دفعات تاجر — لا تخمّن merchantId أبداً.",
    schema: searchMerchantsSchema,
    execute: async ({ query, limit }) => searchMerchants(query, limit),
  } satisfies ToolDefinition<z.infer<typeof searchMerchantsSchema>>,

  get_merchant_account_summary: {
    description: "أرجع الذمة الحالية الحقيقية لتاجر محدد مسبقاً، وآخر بيع وآخر دفعة والمندوب المسؤول.",
    schema: getMerchantAccountSummarySchema,
    execute: async ({ merchantId }) => getMerchantAccountSummary(merchantId),
  } satisfies ToolDefinition<z.infer<typeof getMerchantAccountSummarySchema>>,

  get_merchant_recent_activity: {
    description: "أرجع آخر حركات (مبيعات ودفعات) تاجر محدد مسبقاً، بعدد محدود.",
    schema: getMerchantRecentActivitySchema,
    execute: async ({ merchantId, limit }) => getMerchantRecentActivity(merchantId, limit),
  } satisfies ToolDefinition<z.infer<typeof getMerchantRecentActivitySchema>>,

  search_reps: {
    description: "ابحث عن مندوب مبيعات حقيقي بالاسم. استخدمها قبل أي سؤال يذكر مندوباً بالاسم (مثل \"أحمد\") — لا تخمّن repId أبداً.",
    schema: searchRepsSchema,
    execute: async ({ query, limit }) => searchReps(query, limit),
  } satisfies ToolDefinition<z.infer<typeof searchRepsSchema>>,

  get_rep_summary: {
    description: "أرجع ملخص مندوب محدد مسبقاً: مخزون سيارته، مبيعاته، والدفعات التي حصّلها (افتراضياً اليوم إن لم تُحدَّد فترة).",
    schema: getRepSummarySchema,
    execute: async ({ repId, period }) => getRepSummary(repId, period),
  } satisfies ToolDefinition<z.infer<typeof getRepSummarySchema>>,
} as const;

export type OviAiToolName = keyof typeof OVI_AI_TOOLS;
