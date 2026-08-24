import { z } from "zod";

const transferLineSchema = z.object({
  productId: z.string().min(1, "المنتج مطلوب"),
  variantId: z.string().nullable().optional(),
  deviceColorVariantId: z.string().nullable().optional(),
  quantity: z.number().int("الكمية يجب أن تكون رقماً صحيحاً").positive("الكمية يجب أن تكون أكبر من صفر"),
});

/** A pure warehouse<->rep-car stock movement — no customer/order context, so
 * a line has no colorId at all: color is only ever recorded on an order
 * line, never on a stock transfer, and never affects which InventoryItem
 * bucket moves (see the InventoryItem doc comment in prisma/schema.prisma).
 * Multiple lines in one submission become one RepStockTransferBatch with one
 * StockMovement per line — see assignStockToRep/returnStockFromRep in
 * src/app/admin/reps/actions.ts.
 *
 * loadType/customerName are only ever sent (and only ever meaningful) on an
 * assignStockToRep submission — returnStockFromRep parses the same schema
 * but never reads either field. loadType defaults to CAR_STOCK (the
 * original behavior) when omitted; customerName's real "required when
 * CUSTOMER_ORDER" rule is enforced in assignStockToRep itself, not here,
 * since that rule doesn't apply to a return submission at all.
 *
 * Deliberately no uniqueness .refine() here (previously present, and the
 * likely cause of a production bug: the product picker's detail modal never
 * disables an option just because it's already in the line list — only
 * out-of-stock options are disabled — so re-picking the exact same
 * product+variant+combo while building a long list was always possible, and
 * used to fail the whole submission outright with a generic error after
 * potentially many entered lines). assignStockToRep/returnStockFromRep now
 * aggregate any duplicate exact target into one effective line, summing
 * quantities, before validation/movement — the same pattern already used by
 * createBulkStockMovement in src/app/admin/inventory/actions.ts. The
 * product picker also now merges a duplicate pick client-side, so this
 * server-side aggregation is a backstop, not the primary defense. */
export const repStockTransferBatchSchema = z.object({
  items: z
    .array(transferLineSchema)
    .min(1, "يجب إضافة منتج واحد على الأقل")
    .max(100, "عدد كبير جداً من المنتجات في عملية نقل واحدة (الحد الأقصى 100 صنف) — قسّمها إلى أكثر من عملية"),
  notes: z.string().max(500, "الملاحظات طويلة جداً").optional(),
  loadType: z.enum(["CAR_STOCK", "CUSTOMER_ORDER"]).optional(),
  customerName: z.string().trim().max(200, "اسم الزبون طويل جداً").optional(),
});

export type RepStockTransferBatchInput = z.infer<typeof repStockTransferBatchSchema>;
