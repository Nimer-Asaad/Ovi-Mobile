/** Shared types for the Ovi AI feature (src/lib/ai/**). Ovi AI local V1 has
 * NO generative provider anywhere in this app — these types no longer carry
 * any provider-SDK shape at all (that whole concept, and provider.ts itself,
 * is gone). Everything here is either conversational memory, a structured
 * native-React answer shape, or an autocomplete suggestion shape. */

/** Structured conversational memory — the thing that actually makes
 * follow-ups like "طيب الجلد بس" / "مين معه منهم؟" / "وأحمد؟" work, instead of
 * re-parsing unlimited raw chat history. The local engine (src/lib/ai/local/
 * engine.ts) updates this after any successful entity resolution and returns
 * the new value to the client, which sends it back on the next request —
 * this is the ENTIRE "conversation storage" for V1 (request-scoped, never
 * persisted to the database). */
export interface OviAiContext {
  resolvedProductId?: string | null;
  resolvedProductLabel?: string | null;
  resolvedPhoneModelId?: string | null;
  resolvedPhoneModelLabel?: string | null;
  resolvedMerchantId?: string | null;
  resolvedMerchantLabel?: string | null;
  resolvedRepId?: string | null;
  resolvedRepLabel?: string | null;
  /** The last LocalIntent label (see src/lib/ai/local/types.ts) — advisory
   * only, used to pick a sensible fallback category for a contextless
   * follow-up; never used for server-side authorization. */
  lastIntent?: string | null;
  period?: { fromIso: string; toIso: string; label: string } | null;
}

export const EMPTY_OVI_AI_CONTEXT: OviAiContext = {};

export interface OviAiChatMessage {
  role: "user" | "assistant";
  content: string;
}

/** One clickable follow-up suggestion — clicking it re-sends `message` as if
 * the user had typed it themselves. Never a hidden/implicit action; always a
 * normal chat turn, so it goes through the exact same local-engine path
 * (including read-only enforcement) as manual typing. */
export interface OviAiChip {
  label: string;
  message: string;
  /** Present ONLY on a real DB-backed disambiguation candidate chip (see
   * resolveEntity in src/lib/ai/local/entity-resolution.ts) — lets the
   * client remember a user's explicit pick as a local learning alias
   * (OviAiLearnedAlias below). Absent on a plain follow-up/starter
   * suggestion chip, which carries no entity identity to learn from. */
  entityId?: string;
  entityType?: OviAiSuggestionEntityType;
}

/** The closed set of native-React answer shapes the local engine can
 * produce — replaces the old free-text/Markdown reply entirely (this is
 * what fixes the production bug where a Markdown table rendered as raw
 * "| الصنف | الكمية |" text). `kind` picks which renderer
 * (src/components/admin/ai/StructuredAnswer.tsx) draws the card; every other
 * field is optional because different kinds use different subsets. */
export type StructuredResponseKind =
  | "TEXT"
  | "INVENTORY"
  | "LOW_STOCK"
  | "STOCK_LOCATIONS"
  | "REP_INVENTORY"
  | "PRODUCT_SALES"
  | "SALES_SUMMARY"
  | "TOP_SELLING"
  | "MERCHANT_ACCOUNT"
  | "MERCHANT_ACTIVITY"
  | "REP_SUMMARY"
  | "PRODUCT_PRICE"
  | "CLARIFICATION"
  | "NO_MATCH"
  | "READ_ONLY"
  | "ERROR";

export interface StructuredMetric {
  label: string;
  value: string;
}

export interface StructuredRow {
  label: string;
  value: string;
  subLabel?: string | null;
}

export interface StructuredSection {
  title?: string;
  rows: StructuredRow[];
}

export interface StructuredTable {
  columns: string[];
  rows: (string | number)[][];
}

/** One full structured answer. `summary` is always a short, plain (never
 * Markdown) sentence suitable as a bubble's headline even before the richer
 * `metrics`/`sections`/`table` are rendered. Every number/label in every
 * field always came from a real tool result read this turn — the local
 * engine never fabricates one (see src/lib/ai/local/response-builder.ts). */
export interface StructuredResponse {
  kind: StructuredResponseKind;
  title?: string;
  summary: string;
  metrics?: StructuredMetric[];
  sections?: StructuredSection[];
  table?: StructuredTable;
}

/** What one local-engine turn returns to the server action, which passes it
 * straight to the client. */
export interface OviAiTurnResult {
  response: StructuredResponse;
  context: OviAiContext;
  suggestions: OviAiChip[];
  /** Present only when the engine is presenting DB-backed disambiguation
   * candidates (see resolveEntity in src/lib/ai/local/entity-resolution.ts)
   * — rendered as chips the user can tap instead of retyping. */
  candidates?: OviAiChip[];
}

/** One autocomplete suggestion shown while the user is still typing (see
 * src/lib/ai/local/autocomplete.ts). `entityId`/`entityType` are present
 * only for an ENTITY suggestion, and are always a real, freshly-read DB id —
 * the client may cache them (see OviAiLearnedAlias below) but the server
 * ALWAYS re-validates before ever using one in a factual tool call. */
export type OviAiSuggestionType = "ENTITY" | "QUERY" | "CLARIFICATION";
export type OviAiSuggestionEntityType = "PRODUCT" | "PHONE_MODEL" | "MERCHANT" | "REP";

export interface OviAiSuggestion {
  type: OviAiSuggestionType;
  label: string;
  /** The full message to send if this suggestion is picked. */
  query: string;
  entityId?: string;
  entityType?: OviAiSuggestionEntityType;
}

/** One user-confirmed disambiguation choice, kept ONLY in the browser's own
 * localStorage (see src/components/admin/ai/OviAiChat.tsx) — never sent
 * anywhere except back to this app's own server as an optional ranking hint
 * on a future turn. The server treats `entityId` as an untrusted hint: it
 * only ever amplifies a candidate its OWN fresh DB search already found for
 * the current query, and is silently ignored otherwise (see
 * resolveEntity's `learnedHint` parameter) — a tampered/stale value here can
 * never inject a fact the search didn't already surface. */
export interface OviAiLearnedAlias {
  normalizedPhrase: string;
  entityId: string;
  entityType: OviAiSuggestionEntityType;
  label: string;
  createdAt: number;
}
