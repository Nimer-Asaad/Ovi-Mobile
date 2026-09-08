/** Shared types for the Ovi AI feature (src/lib/ai/**). Deliberately
 * separate from any provider SDK's own types — the orchestrator/tools never
 * import an OpenAI-specific type outside src/lib/ai/provider.ts, so swapping
 * providers later never touches this file or the tool layer. */

/** Structured conversational memory — the thing that actually makes
 * follow-ups like "طيب الجلد بس" / "مين معه منهم؟" / "وأحمد؟" work, instead of
 * re-sending unlimited raw chat history and hoping the model infers it. The
 * orchestrator updates this after any successful entity resolution and
 * returns the new value to the client, which sends it back on the next
 * request — this is the ENTIRE "conversation storage" for V1 (see the
 * feature report: request-scoped, never persisted to the database). */
export interface OviAiContext {
  resolvedProductId?: string | null;
  resolvedProductLabel?: string | null;
  resolvedPhoneModelId?: string | null;
  resolvedPhoneModelLabel?: string | null;
  resolvedMerchantId?: string | null;
  resolvedMerchantLabel?: string | null;
  resolvedRepId?: string | null;
  resolvedRepLabel?: string | null;
  /** Free-form label for the model to note what the user last asked about
   * (e.g. "INVENTORY", "SALES", "MERCHANT_DEBT") — advisory only, never used
   * for server-side authorization or branching logic. */
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
 * normal chat turn, so it goes through the exact same orchestrator path
 * (including read-only enforcement) as manual typing. */
export interface OviAiChip {
  label: string;
  message: string;
}

/** What one orchestrator turn returns to the server action, which passes it
 * straight to the client. */
export interface OviAiTurnResult {
  reply: string;
  context: OviAiContext;
  suggestions: OviAiChip[];
  /** Present only when the model is presenting DB-backed disambiguation
   * candidates (see searchCatalogCandidates/searchMerchants) — rendered as
   * chips the user can tap instead of retyping. */
  candidates?: OviAiChip[];
}
