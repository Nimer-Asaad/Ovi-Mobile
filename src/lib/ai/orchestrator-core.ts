/** The actual Ovi AI tool-calling control flow — deliberately provider- and
 * DB-agnostic (no "server-only" import, no OpenAI/Prisma import) so it can
 * be unit-tested directly with mocked `chat`/tool functions (see the
 * feature report's E2E mock tests). src/lib/ai/orchestrator.ts is the thin,
 * server-only wrapper that supplies the REAL provider call and the REAL
 * tool registry as injected dependencies — this file is the one that
 * actually runs in production either way; nothing here is a test-only
 * reimplementation. */

import { EMPTY_OVI_AI_CONTEXT, type OviAiChatMessage, type OviAiChip, type OviAiContext, type OviAiTurnResult } from "@/lib/ai/types";
import { classifyIntent, type OviDataCategory } from "@/lib/ai/intent";

/** Deterministic tool -> real-data-category map — CATEGORY-AWARE grounding,
 * not a flat "any fact tool ran" check. A category is listed for a tool
 * ONLY when that tool's ACTUAL TypeScript return interface truly contains a
 * field for it (audited against src/lib/ai/tools/**.ts at the time this was
 * written — e.g. get_product_details's real ProductDetails interface has
 * wholesalePriceCents/retailPriceCents (PRICE) and category/brand/sku/
 * compatibleModels (CATALOG) but NO stock-quantity field at all, so it is
 * NOT listed under INVENTORY here, even though a naive reading of its name
 * might suggest it should be). This is what makes it impossible for e.g. a
 * SALES tool's successful result to ground an INVENTORY claim, or for a
 * search tool (proving identity only — deliberately absent from this map
 * entirely) to ground any quantity/amount claim. Multiple categories on one
 * tool are only listed when that tool's result genuinely carries all of
 * them (e.g. get_sales_summary's real SalesSummary has BOTH
 * salesTotalCents/activeSalesCount (SALES) AND paymentsTotalCents/
 * paymentsCount (PAYMENTS) as separate fields). */
const TOOL_CAPABILITIES: Record<string, OviDataCategory[]> = {
  get_inventory_summary: ["INVENTORY"],
  get_rep_inventory_breakdown: ["INVENTORY", "REP"],
  get_stock_locations_for_item: ["INVENTORY"],
  get_low_stock_items: ["INVENTORY"],
  get_product_details: ["CATALOG", "PRICE"],
  get_sales_summary: ["SALES", "PAYMENTS"],
  get_product_sales: ["SALES"],
  get_top_selling_products: ["SALES"],
  get_merchant_account_summary: ["MERCHANT_ACCOUNT", "MERCHANT_ACTIVITY"],
  get_merchant_recent_activity: ["MERCHANT_ACTIVITY"],
  get_rep_summary: ["REP", "INVENTORY", "SALES", "PAYMENTS"],
  // search_catalog_candidates / search_merchants / search_reps are
  // DELIBERATELY absent — they prove WHO/WHAT an entity is, never a
  // quantity/amount, so they contribute zero grounding categories. See
  // isClarificationTurn in runOrchestratorTurn for their own, separate,
  // narrower carve-out (a clarification/no-match REPLY, never a fact).
};

/** The three entity-resolution search tools. Used by the deterministic
 * clarification short-circuit below (see the "search_*" check inside the
 * tool-call loop) — never by the grounding check itself (they carry no
 * TOOL_CAPABILITIES entry at all, so they can never satisfy one). */
const SEARCH_TOOL_NAMES = new Set(["search_catalog_candidates", "search_merchants", "search_reps"]);

/** Hard cap on tool round-trips within one user turn — prevents an infinite
 * or runaway tool loop and bounds latency/cost. 6 is enough for every
 * documented flow (search -> resolve -> fetch, sometimes with one extra
 * disambiguation retry) while still failing fast if the model gets stuck. */
export const MAX_TOOL_STEPS = 6;

/** Only the trailing messages are ever sent to the model — conversation
 * continuity comes from the structured OviAiContext, not from re-sending
 * unbounded raw history. 8 messages = 4 user/assistant turns. */
const MAX_HISTORY_MESSAGES = 8;

const FRIENDLY_ERROR_MESSAGE = "صار خلل مؤقت بالمساعد، جرّب مرة ثانية.";
const AMBIGUOUS_TOOL_STEPS_MESSAGE = "الطلب معقد أكثر من اللازم، ممكن تسأل بشكل أبسط أو تحدد أكثر؟";
/** GROUNDING SAFEGUARD's own fallback — see hasUngroundedNumbers below. */
const UNGROUNDED_FALLBACK_MESSAGE = "ما قدرت أتأكد من الأرقام الحقيقية لهالسؤال، ممكن تسأل بشكل أوضح أو تحدد الصنف/التاجر/المندوب؟";

export interface CoreToolCall {
  callId: string;
  name: string;
  argumentsJson: string;
}

export interface CoreChatResult<Item> {
  outputText: string | null;
  toolCalls: CoreToolCall[];
  /** This step's own output items, to be threaded back into the next
   * request's conversation state unchanged — opaque to this file, whatever
   * shape the injected provider uses. */
  outputItems: Item[];
}

export interface CoreToolDefinition {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

export type CoreChatFn<Item> = (request: { instructions: string; input: Item[]; tools: CoreToolDefinition[] }) => Promise<CoreChatResult<Item>>;

/** Structurally what every real zod schema satisfies — the core never
 * imports zod itself, just relies on this shape (duck typing), so a test
 * can supply a trivial hand-written mock schema instead. */
export interface CoreValidator {
  safeParse: (input: unknown) => { success: boolean; data?: unknown; error?: { issues: { message: string }[] } };
}

export interface CoreToolRegistryEntry {
  description: string;
  schema: CoreValidator;
  execute: (args: never) => Promise<unknown>;
}

export interface OrchestratorDeps<Item> {
  chat: CoreChatFn<Item>;
  buildMessageItem: (role: "user" | "assistant", content: string) => Item;
  buildToolResultItem: (callId: string, outputJson: string) => Item;
  tools: Record<string, CoreToolRegistryEntry>;
  toolDefinitions: CoreToolDefinition[];
  /** Builds the system/instructions text for one turn — injected so this
   * file never imports the (server-only) system-prompt module directly. */
  buildInstructions: (context: OviAiContext, todayIso: string) => string;
  todayIso: string;
}

interface ExecutedToolCall {
  name: string;
  args: Record<string, unknown>;
  result: unknown;
}

async function executeToolCall(tools: Record<string, CoreToolRegistryEntry>, name: string, argumentsJson: string): Promise<{ resultText: string; executed: ExecutedToolCall | null }> {
  const tool = tools[name];
  if (!tool) {
    return { resultText: JSON.stringify({ error: "أداة غير معروفة" }), executed: null };
  }

  let rawArgs: unknown;
  try {
    rawArgs = argumentsJson ? JSON.parse(argumentsJson) : {};
  } catch {
    return { resultText: JSON.stringify({ error: "تعذّر قراءة معطيات الأداة" }), executed: null };
  }

  const parsed = tool.schema.safeParse(rawArgs);
  if (!parsed.success) {
    return { resultText: JSON.stringify({ error: "معطيات غير صالحة", details: parsed.error?.issues.map((issue) => issue.message) ?? [] }), executed: null };
  }

  try {
    const result = await tool.execute(parsed.data as never);
    return { resultText: JSON.stringify(result ?? { found: false }), executed: { name, args: parsed.data as Record<string, unknown>, result } };
  } catch (error) {
    console.error("[ovi-ai] tool execution failed", { tool: name, message: error instanceof Error ? error.message : "unknown" });
    return { resultText: JSON.stringify({ error: "تعذّر تنفيذ الأداة" }), executed: null };
  }
}

/** Deterministically updates the structured conversation context from the
 * tool calls ACTUALLY executed this turn — never from the model's own
 * prose. Every id written into context here is the literal argument to a
 * real tool call this same request just ran, and every label comes from
 * that tool's own RESULT (freshly read from the DB), never from whatever
 * label the client happened to send in — so a tampered/stale client-
 * supplied OviAiContext can influence AT MOST which tool the model decides
 * to call next (a conversational hint), never what the returned context
 * ends up asserting as true. */
function updateContextFromToolCalls(context: OviAiContext, executed: ExecutedToolCall[]): OviAiContext {
  const next = { ...context };

  for (const call of executed) {
    switch (call.name) {
      case "get_inventory_summary":
      case "get_rep_inventory_breakdown":
      case "get_stock_locations_for_item":
      case "get_product_sales": {
        const args = call.args as { targetType?: string; targetId?: string };
        const result = call.result as { label?: string } | null;
        if (!result || !args.targetId) break;
        if (args.targetType === "PRODUCT") {
          next.resolvedProductId = args.targetId;
          next.resolvedProductLabel = result.label ?? null;
          next.resolvedPhoneModelId = null;
          next.resolvedPhoneModelLabel = null;
        } else if (args.targetType === "PHONE_MODEL") {
          next.resolvedPhoneModelId = args.targetId;
          next.resolvedPhoneModelLabel = result.label ?? null;
          next.resolvedProductId = null;
          next.resolvedProductLabel = null;
        }
        next.lastIntent = "INVENTORY";
        break;
      }
      case "get_product_details": {
        const args = call.args as { productId?: string };
        const result = call.result as { name?: string; nameAr?: string | null } | null;
        if (!result || !args.productId) break;
        next.resolvedProductId = args.productId;
        next.resolvedProductLabel = result.nameAr ?? result.name ?? null;
        next.lastIntent = "PRODUCT_DETAILS";
        break;
      }
      case "get_merchant_account_summary":
      case "get_merchant_recent_activity": {
        const args = call.args as { merchantId?: string };
        const result = call.result as { label?: string } | null;
        if (!args.merchantId) break;
        next.resolvedMerchantId = args.merchantId;
        if (result && "label" in result) next.resolvedMerchantLabel = result.label ?? null;
        next.lastIntent = "MERCHANT";
        break;
      }
      case "get_rep_summary": {
        const args = call.args as { repId?: string };
        const result = call.result as { repName?: string } | null;
        if (!result || !args.repId) break;
        next.resolvedRepId = args.repId;
        next.resolvedRepLabel = result.repName ?? null;
        next.lastIntent = "REP";
        break;
      }
      case "get_sales_summary":
      case "get_top_selling_products": {
        const result = call.result as { period?: { fromIso: string; toIso: string; label: string } } | null;
        if (result?.period) next.period = result.period;
        next.lastIntent = "SALES";
        break;
      }
      default:
        break;
    }
  }

  return next;
}

/** Only ever built from REAL search-tool results, never invented — surfaced
 * as tappable chips. Fires whenever the last tool call this turn was a
 * search_* tool AND its own deterministic `recommendedAction` (see
 * src/lib/ai/fuzzy.ts) was NOT "AUTO_RESOLVE" — covers both a genuinely
 * ambiguous multi-candidate result (ASK_USER) and a near-miss/no-exact-match
 * result (NO_MATCH), so the "closest real candidates" UX requirement is
 * satisfied even on a miss, not just on ambiguity. */
function buildCandidateChips(executed: ExecutedToolCall[]): OviAiChip[] | undefined {
  const last = executed[executed.length - 1];
  if (!last) return undefined;

  if (last.name === "search_catalog_candidates" || last.name === "search_merchants" || last.name === "search_reps") {
    const result = last.result as { candidates?: { label: string }[]; recommendedAction?: string } | null;
    if (!result || result.recommendedAction === "AUTO_RESOLVE") return undefined;
    const candidates = result.candidates ?? [];
    if (candidates.length === 0) return undefined;
    return candidates.slice(0, 6).map((candidate) => ({ label: candidate.label, message: candidate.label }));
  }
  return undefined;
}

/** Small, deterministic set of contextually useful next questions — built
 * from template phrases referencing only ALREADY-RESOLVED real entity
 * labels already in context (never invented content). */
function buildFollowUpSuggestions(context: OviAiContext): OviAiChip[] {
  const chips: OviAiChip[] = [];
  const itemLabel = context.resolvedProductLabel ?? context.resolvedPhoneModelLabel;

  if (itemLabel && context.lastIntent === "INVENTORY") {
    chips.push({ label: "مين معه بالسيارات؟", message: `مين معه ${itemLabel} بالسيارات؟` });
    chips.push({ label: "مبيعات الشهر", message: `كم بعنا ${itemLabel} هالشهر؟` });
    chips.push({ label: "وين موجود؟", message: `وين موجود ${itemLabel}؟` });
  } else if (context.resolvedMerchantLabel) {
    chips.push({ label: "آخر الحركات", message: `آخر حركات ${context.resolvedMerchantLabel}` });
    chips.push({ label: "آخر دفعة", message: `آخر دفعة لـ ${context.resolvedMerchantLabel} متى؟` });
  } else if (context.resolvedRepLabel) {
    chips.push({ label: "مخزون السيارة", message: `شو معه ${context.resolvedRepLabel} بالسيارة؟` });
    chips.push({ label: "مبيعات اليوم", message: `كم باع ${context.resolvedRepLabel} اليوم؟` });
  } else {
    chips.push({ label: "شو قرب يخلص؟", message: "شو قرب يخلص بالمخزون؟" });
    chips.push({ label: "مبيعات اليوم", message: "مبيعات اليوم" });
  }

  return chips.slice(0, 4);
}

/** The union of real data categories actually covered by this turn's
 * successful tool executions — via TOOL_CAPABILITIES, so a search tool
 * (absent from that map entirely) can never contribute anything, and
 * neither can a fact tool that itself came back empty (target not found). */
function coveredCategories(executed: ExecutedToolCall[]): Set<OviDataCategory> {
  const covered = new Set<OviDataCategory>();
  for (const call of executed) {
    if (call.result === null || call.result === undefined) continue;
    const capabilities = TOOL_CAPABILITIES[call.name];
    if (!capabilities) continue;
    for (const category of capabilities) covered.add(category);
  }
  return covered;
}

/** True only when EVERY required category is covered — AND semantics, not
 * "any one will do". A compound question ("كم عنا A26 وكم بعنا منه؟" ->
 * INVENTORY + SALES) is only grounded once BOTH categories were actually
 * fetched this turn; a single matching tool is never enough to answer the
 * other half. `requiredCategories.length === 0` (nothing specific
 * classified, e.g. plain "GENERAL" chat) is vacuously satisfied. */
function hasSufficientGrounding(requiredCategories: OviDataCategory[], executed: ExecutedToolCall[]): boolean {
  if (requiredCategories.length === 0) return true;
  const covered = coveredCategories(executed);
  return requiredCategories.every((category) => covered.has(category));
}

/** GROUNDING / PROVENANCE SAFEGUARD — the structural (not merely prompt-
 * based) guarantee that Ovi AI can never assert a business fact it didn't
 * actually just look up, matched to the RIGHT DATA CATEGORY, not merely
 * "some fact tool ran". PRIMARY mechanism: `classifyIntent` (src/lib/ai/
 * intent.ts) deterministically classifies whether THIS turn's user message
 * needs company data and WHICH category/categories (INVENTORY, PRICE,
 * SALES, PAYMENTS, MERCHANT_ACCOUNT, MERCHANT_ACTIVITY, REP, CATALOG); if
 * it does, the turn's own executed tool calls (server-side execution
 * records — never the model's own prose claiming "I checked") must cover
 * EVERY one of those categories via TOOL_CAPABILITIES (hasSufficientGrounding
 * above) — a sales tool's success can never ground an inventory claim, a
 * merchant-identity search can never ground a debt figure, and a single-
 * category tool can never ground a two-part compound question on its own.
 * The one carved-out exception: a turn whose only tool activity was a
 * search that came back genuinely ambiguous or empty is still allowed to
 * answer — but ONLY with the resulting candidate-chips clarification/no-
 * match message, never a business-quantity claim (see `isClarificationTurn`
 * below, gated on `candidates` actually being non-empty, itself only ever
 * built from real search results). If neither condition holds, the reply
 * is replaced outright with a safe, generic message before it ever reaches
 * the user.
 *
 * DEFENSE IN DEPTH (secondary, kept intentionally even though it's no
 * longer primary): if NO tool executed at all this turn and the final text
 * still contains a raw digit (Arabic-Indic or Latin), it's replaced too —
 * catches anything classifyIntent's keyword/context heuristic might miss,
 * independent of that classification. */
function hasUngroundedNumbers(reply: string, executed: ExecutedToolCall[]): boolean {
  if (executed.length > 0) return false;
  return /[0-9٠-٩]/.test(reply);
}

export interface OrchestratorInput {
  message: string;
  history: OviAiChatMessage[];
  context: OviAiContext;
}

/** Runs one full Ovi AI turn: builds instructions + bounded history + user
 * message, loops on tool calls (bounded by MAX_TOOL_STEPS) via the injected
 * `chat` function until the model returns a final answer with no further
 * tool calls, applies the grounding safeguard, then deterministically
 * derives the updated context + suggestion/candidate chips from the tool
 * calls actually executed. Never throws to the caller — resolves to a safe
 * OviAiTurnResult on any failure. */
export async function runOrchestratorTurn<Item>(input: OrchestratorInput, deps: OrchestratorDeps<Item>): Promise<OviAiTurnResult> {
  const context = input.context ?? EMPTY_OVI_AI_CONTEXT;

  const conversation: Item[] = [
    ...input.history.slice(-MAX_HISTORY_MESSAGES).map((entry) => deps.buildMessageItem(entry.role, entry.content)),
    deps.buildMessageItem("user", input.message),
  ];

  const executedThisTurn: ExecutedToolCall[] = [];

  try {
    for (let step = 0; step < MAX_TOOL_STEPS; step += 1) {
      const instructions = deps.buildInstructions(context, deps.todayIso);
      const result = await deps.chat({ instructions, input: conversation, tools: deps.toolDefinitions });

      if (result.toolCalls.length === 0) {
        let reply = result.outputText?.trim() || FRIENDLY_ERROR_MESSAGE;
        const candidates = buildCandidateChips(executedThisTurn);
        // A clarification/no-match turn (real DB candidates surfaced, no
        // AUTO_RESOLVE) is valid grounding for exactly that — asking which
        // one, or saying none matched — never for a business-quantity claim.
        const isClarificationTurn = Boolean(candidates && candidates.length > 0);

        const intent = classifyIntent(input.message, context);
        if (intent.requiresData && !isClarificationTurn && !hasSufficientGrounding(intent.categories, executedThisTurn)) {
          reply = UNGROUNDED_FALLBACK_MESSAGE;
        } else if (hasUngroundedNumbers(reply, executedThisTurn)) {
          reply = UNGROUNDED_FALLBACK_MESSAGE;
        }

        const nextContext = updateContextFromToolCalls(context, executedThisTurn);
        return {
          reply,
          context: nextContext,
          suggestions: buildFollowUpSuggestions(nextContext),
          candidates,
        };
      }

      conversation.push(...result.outputItems);

      const stepExecuted: ExecutedToolCall[] = [];
      for (const call of result.toolCalls) {
        const { resultText, executed } = await executeToolCall(deps.tools, call.name, call.argumentsJson);
        if (executed) {
          executedThisTurn.push(executed);
          stepExecuted.push(executed);
        }
        conversation.push(deps.buildToolResultItem(call.callId, resultText));
      }

      // Deterministic clarification short-circuit: when this step's ONLY
      // executed call was a search_* tool and its own recommendedAction
      // says the result is not safely auto-resolvable, skip the extra
      // chat() round-trip and return the fixed Arabic clarification/
      // no-match message with the real candidate chips directly — cheaper,
      // faster, and removes any chance of the model quietly picking one on
      // its own instead of asking (see the feature report). A step that did
      // anything ELSE alongside the search still goes back to the model
      // normally. AUTO_RESOLVE never short-circuits here — that case must
      // continue to the next step so the model can follow up with the
      // actual fact tool (see hasSufficientGrounding/isClarificationTurn above:
      // an AUTO_RESOLVE-only turn is deliberately NOT treated as a
      // complete, grounded business answer).
      if (stepExecuted.length === 1 && SEARCH_TOOL_NAMES.has(stepExecuted[0]!.name)) {
        const searchResult = stepExecuted[0]!.result as { candidates?: { label: string }[]; recommendedAction?: string } | null;
        if (searchResult && searchResult.recommendedAction && searchResult.recommendedAction !== "AUTO_RESOLVE") {
          const candidates = (searchResult.candidates ?? []).slice(0, 6).map((candidate) => ({ label: candidate.label, message: candidate.label }));
          const reply =
            candidates.length > 0
              ? searchResult.recommendedAction === "NO_MATCH"
                ? "ما لقيت صنف مطابق بالضبط، أقرب الموجود عندنا:"
                : "لقيت أكثر من احتمال، أي واحد تقصد؟"
              : "ما لقيت صنف مطابق بشكل واضح.";
          const nextContext = updateContextFromToolCalls(context, executedThisTurn);
          return {
            reply,
            context: nextContext,
            suggestions: buildFollowUpSuggestions(nextContext),
            candidates: candidates.length > 0 ? candidates : undefined,
          };
        }
      }
    }
  } catch (error) {
    console.error("[ovi-ai] orchestrator turn failed", { message: error instanceof Error ? error.message : "unknown" });
    return { reply: FRIENDLY_ERROR_MESSAGE, context, suggestions: buildFollowUpSuggestions(context) };
  }

  // Exhausted MAX_TOOL_STEPS without a final answer — never loop forever.
  const nextContext = updateContextFromToolCalls(context, executedThisTurn);
  return { reply: AMBIGUOUS_TOOL_STEPS_MESSAGE, context: nextContext, suggestions: buildFollowUpSuggestions(nextContext) };
}
