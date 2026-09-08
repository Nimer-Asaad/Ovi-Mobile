/** Internal types for the local (zero-LLM) Ovi AI engine. Never imported by
 * the client — these describe the deterministic router's decisions and the
 * entity-resolution step, not anything sent over the wire (see
 * src/lib/ai/types.ts for the client-facing shapes). */

import type { SalesPeriodInput } from "@/lib/ai/tools/sales";
import type { OviAiChip } from "@/lib/ai/types";

/** The specific, actionable question the router decided the user is asking
 * — one level more specific than OviDataCategory (src/lib/ai/intent.ts),
 * chosen so each value maps to exactly one Ovi AI capability/tool. */
export type LocalIntent =
  | "LOW_STOCK"
  | "STOCK_LOCATIONS"
  | "REP_INVENTORY"
  | "REP_SUMMARY"
  | "PRODUCT_PRICE"
  | "PRODUCT_SALES"
  | "SALES_SUMMARY"
  | "TOP_SELLING"
  | "MERCHANT_BALANCE"
  | "MERCHANT_ACTIVITY"
  | "INVENTORY_SUMMARY"
  | "READ_ONLY_REFUSAL"
  | "CONVERSATIONAL"
  | "GENERAL_HELP";

/** Which kind of real entity (if any) this LocalIntent needs resolved before
 * a tool can run, and — for SALES/PAYMENTS-flavored questions where a bare
 * name could be either a product or a rep ("مبيعات أحمد اليوم؟") —
 * AMBIGUOUS_NAME tells entity-resolution.ts to try REP first, then CATALOG. */
export type EntityKindHint = "CATALOG" | "MERCHANT" | "REP" | "AMBIGUOUS_NAME" | "NONE";

/** The router's full, deterministic decision for one message — see
 * src/lib/ai/local/router.ts. Never includes anything not derivable from
 * the message text + the current OviAiContext; never a DB call. */
export interface LocalQueryPlan {
  intent: LocalIntent;
  entityKind: EntityKindHint;
  /** Cleaned leftover text likely naming the entity (clitics/question-words/
   * glossary/period-words stripped) — empty when the message carries no new
   * entity mention at all, meaning "reuse whatever is already resolved in
   * context" (a follow-up like "طيب الجلد بس"). */
  entityQuery: string;
  /** Explicit period only when the message itself named one ("هالشهر",
   * "اليوم"...) — null means "let the tool apply its own sensible default"
   * (TODAY for get_rep_summary, THIS's caller decides for sales tools). */
  period: SalesPeriodInput | null;
  /** A real DOMAIN_GLOSSARY term (e.g. "جلد", "شفاف") the message asked to
   * filter/highlight within an inventory breakdown — null when none. */
  materialFilter: string | null;
}

export type ResolvedEntityType = "PRODUCT" | "PHONE_MODEL" | "MERCHANT" | "REP";

export interface LearnedHintInput {
  normalizedPhrase: string;
  entityId: string;
  entityType: ResolvedEntityType;
}

/** The outcome of resolveEntity (src/lib/ai/local/entity-resolution.ts) —
 * RESOLVED only ever carries a real, freshly-read DB id; AMBIGUOUS/NOT_FOUND
 * carry only real search-result candidates (never invented ones). */
export type EntityResolutionStatus = "RESOLVED" | "AMBIGUOUS" | "NOT_FOUND" | "NOT_NEEDED";

export interface EntityResolutionResult {
  status: EntityResolutionStatus;
  type?: ResolvedEntityType;
  id?: string;
  label?: string;
  candidates?: OviAiChip[];
}
