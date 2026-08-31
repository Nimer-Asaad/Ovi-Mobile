import { z } from "zod";

const transferLineSchema = z.object({
  productId: z.string().min(1, "المنتج مطلوب"),
  variantId: z.string().nullable().optional(),
  deviceColorVariantId: z.string().nullable().optional(),
  quantity: z.number().int("الكمية يجب أن تكون رقماً صحيحاً").positive("الكمية يجب أن تكون أكبر من صفر"),
});

/** A pure warehouse -> rep-car stock LOAD (assignStockToRep only — see
 * repCarReturnSchema below for the separate, differently-shaped return
 * path) — no customer/order context, so a line has no colorId at all: color
 * is only ever recorded on an order line, never on a stock transfer, and
 * never affects which InventoryItem bucket moves (see the InventoryItem doc
 * comment in prisma/schema.prisma). Multiple lines in one submission become
 * one RepStockTransferBatch with one StockMovement per line.
 *
 * The warehouse side of a load stays fully dimensional on purpose — the
 * admin must still pick the exact variant/combo so the WAREHOUSE'S own
 * dimensional stock decrements accurately (see the RepCustomerOrder /
 * InventoryItem doc comments for why REP_CAR itself no longer mirrors that
 * same dimensional shape once the load lands: assignStockToRep collapses
 * every line for one product onto that rep's single aggregate car balance).
 *
 * loadType/customerName/customerPhone/merchantId are only ever sent (and
 * only ever meaningful) on an assignStockToRep submission. loadType
 * defaults to CAR_STOCK (the original behavior) when omitted; the real "a
 * CUSTOMER_ORDER must resolve to a real Merchant — via merchantId OR
 * customerName+customerPhone" rule is enforced in assignStockToRep itself,
 * not here, since it doesn't apply to CAR_STOCK at all.
 *
 * Deliberately no uniqueness .refine() here (previously present, and the
 * likely cause of a production bug: the product picker's detail modal never
 * disables an option just because it's already in the line list — only
 * out-of-stock options are disabled — so re-picking the exact same
 * product+variant+combo while building a long list was always possible, and
 * used to fail the whole submission outright with a generic error after
 * potentially many entered lines). assignStockToRep now aggregates any
 * duplicate exact target into one effective line, summing quantities,
 * before validation/movement — the same pattern already used by
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
  /** Required on a CUSTOMER_ORDER submission UNLESS merchantId (below) is
   * already set — an existing trader picked from the list already carries a
   * phone on file, so re-typing it would be pure friction. When present
   * (and merchantId isn't), assignStockToRep uses it to resolve/create a
   * real trader via resolveOrCreateRepMerchant, never to merge by name text
   * alone. */
  customerPhone: z.string().trim().max(40, "رقم الهاتف طويل جداً").optional(),
  /** Set when the admin picked an EXISTING trader from this rep's merchant
   * list (see AssignStockForm's trader autocomplete) instead of typing a
   * new one — the stable Merchant.id, never re-derived from the name/phone
   * text once known. assignStockToRep verifies it belongs to this rep and,
   * if valid, uses it directly instead of re-resolving by phone. */
  merchantId: z.string().trim().optional(),
});

export type RepStockTransferBatchInput = z.infer<typeof repStockTransferBatchSchema>;

const returnBreakdownLineSchema = z.object({
  variantId: z.string().nullable().optional(),
  deviceColorVariantId: z.string().nullable().optional(),
  quantity: z.number().int("الكمية يجب أن تكون رقماً صحيحاً").positive("الكمية يجب أن تكون أكبر من صفر"),
});

const returnLineSchema = z.object({
  productId: z.string().min(1, "المنتج مطلوب"),
  /** The aggregate REP_CAR quantity being removed for this product — always
   * exactly the sum of `breakdown`'s own quantities (the client computes it
   * that way; returnStockFromRep re-verifies the sum server-side too, never
   * trusting this alone). Kept as its own field rather than re-derived
   * purely so the server's "does the car actually have this much" check
   * reads as one plain number, not a fold over breakdown every time. */
  quantity: z.number().int("الكمية يجب أن تكون رقماً صحيحاً").positive("الكمية يجب أن تكون أكبر من صفر"),
  /** Exactly which WAREHOUSE-side model(s)/combo(s) — or, for a plain
   * TOTAL_STOCK product, the one implicit plain line — this returned
   * quantity is being restored as. REP_CAR itself no longer knows this
   * breakdown once stock is loaded (see the InventoryItem doc comment), so
   * an admin MUST supply it by hand here; it is never inferred/guessed. */
  breakdown: z
    .array(returnBreakdownLineSchema)
    .min(1, "حدد توزيع الإرجاع على الأقل لصنف واحد")
    .max(100, "عدد كبير جداً من أسطر التوزيع لهذا المنتج"),
});

/// A rep-car -> warehouse return. Deliberately a DIFFERENT shape from
/// repStockTransferBatchSchema above: because live REP_CAR balances are now
/// a single aggregate quantity per product (see the InventoryItem doc
/// comment), a return can no longer be a flat list of 1:1 dimensional
/// lines — it has to be "how much of this product is leaving the car" PLUS
/// "which exact warehouse leaves that quantity is being restored to,"
/// entered by the admin from their own physical knowledge of what's
/// actually in the car (see returnStockFromRep's own doc comment for why
/// this can never be inferred automatically). returnStockFromRep
/// re-verifies server-side that every line's `breakdown` sums to exactly
/// its own `quantity` — never trusts the client's arithmetic.
export const repCarReturnSchema = z.object({
  returns: z
    .array(returnLineSchema)
    .min(1, "يجب إضافة منتج واحد على الأقل")
    .max(50, "عدد كبير جداً من المنتجات في عملية إرجاع واحدة (الحد الأقصى 50 صنف) — قسّمها إلى أكثر من عملية"),
  notes: z.string().max(500, "الملاحظات طويلة جداً").optional(),
});

export type RepCarReturnInput = z.infer<typeof repCarReturnSchema>;
