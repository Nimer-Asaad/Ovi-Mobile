import "server-only";
import OpenAI from "openai";
import type { ResponseInputItem } from "openai/resources/responses/responses";

/** The ONLY file in this app that imports the OpenAI SDK — every other AI
 * module (orchestrator, tools, system prompt) talks to this thin wrapper,
 * never the SDK directly, so swapping providers (as this file itself now
 * proves — OpenAI-hosted -> Groq) only ever touches this one file.
 *
 * INFERENCE PROVIDER: Groq — reached through the same official `openai` npm
 * SDK (no new dependency), pointed at Groq's OpenAI-compatible endpoint via
 * `baseURL`. `GROQ_API_KEY` (not `OPENAI_API_KEY`) is the only credential
 * read here now.
 *
 * Uses the official Responses API (`client.responses.create`) — the
 * SDK-recommended tool-calling surface, kept unchanged across this provider
 * switch per explicit instruction (never falls back to Chat Completions).
 * Responses-API-specific item shapes (`ResponseInputItem`) are re-exported
 * here as the opaque `ProviderInputItem` type; the orchestrator accumulates
 * and replays them across tool-calling steps without inspecting their
 * internal fields, and the business tool layer (src/lib/ai/tools/**) never
 * imports this module or any OpenAI/Groq type at all. */

const GROQ_BASE_URL = "https://api.groq.com/openai/v1";
const DEFAULT_MODEL = "qwen/qwen3.8-27b";
const PROVIDER_TIMEOUT_MS = 20_000;
/** Bounded output — keeps replies concise (per the "fast, practical, no
 * essays" response-style requirement) and caps cost/latency per turn.
 * Includes both visible output tokens and any reasoning tokens. */
const MAX_OUTPUT_TOKENS = 700;

let cachedClient: OpenAI | null = null;

export class OviAiProviderError extends Error {
  constructor(message: string, public override readonly cause?: unknown) {
    super(message);
    this.name = "OviAiProviderError";
  }
}

/** Lazily constructs the OpenAI SDK client pointed at Groq's OpenAI-
 * compatible endpoint, from the server-only env var — never read anywhere
 * else, never sent to the client. Throws a typed error (caught by the
 * orchestrator/server action, turned into the generic Arabic "صار خلل مؤقت"
 * message) if the key is missing, rather than crashing with the SDK's own
 * error text (which could leak configuration details). */
function getClient(): OpenAI {
  if (cachedClient) return cachedClient;
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) {
    throw new OviAiProviderError("GROQ_API_KEY is not configured");
  }
  cachedClient = new OpenAI({ apiKey, baseURL: GROQ_BASE_URL });
  return cachedClient;
}

/** Default model: qwen/qwen3.8-27b (served by Groq) — chosen for strong
 * Arabic/English mixed understanding and entity/tool-call reasoning while
 * staying fast/cost-conscious. Override via GROQ_MODEL (OPENAI_MODEL is no
 * longer read at all); never hardcoded elsewhere. */
function getModel(): string {
  return process.env.GROQ_MODEL?.trim() || DEFAULT_MODEL;
}

/** Opaque Responses-API input/output item — the orchestrator only ever
 * accumulates and replays these (via the helpers below), never constructs
 * or inspects one directly, keeping it provider-agnostic in practice. */
export type ProviderInputItem = ResponseInputItem;

export function buildMessageItem(role: "user" | "assistant", content: string): ProviderInputItem {
  return { role, content, type: "message" };
}

/** Wraps one tool's JSON result as a `function_call_output` item, keyed to
 * the model's own `callId` — the required Responses-API shape for feeding a
 * tool result back for the next step. */
export function buildFunctionCallOutputItem(callId: string, outputJson: string): ProviderInputItem {
  return { type: "function_call_output", call_id: callId, output: outputJson };
}

export interface ProviderTool {
  name: string;
  description: string;
  /** A JSON Schema object (from each tool's own zod schema — see
   * tools/index.ts) — never hand-written, never accepts arbitrary shapes. */
  parameters: Record<string, unknown>;
}

export interface ProviderToolCall {
  callId: string;
  name: string;
  /** Raw JSON string exactly as the model returned it — parsing/validation
   * happens in the orchestrator (against each tool's own zod schema), never
   * here. */
  argumentsJson: string;
}

export interface ProviderTurnResult {
  /** The model's own concatenated final text for this step, if any —
   * `response.output_text`, empty string normalized to null. */
  outputText: string | null;
  toolCalls: ProviderToolCall[];
  /** This response's own output items, to be pushed back into the next
   * request's `input` array unchanged (Responses API is item-based —
   * ResponseOutputItem round-trips directly as ResponseInputItem). */
  outputItems: ProviderInputItem[];
}

export interface ProviderRequestOptions {
  instructions: string;
  input: ProviderInputItem[];
  tools: ProviderTool[];
}

/** One Responses API call with function/tool calling — bounded by a hard
 * timeout (PROVIDER_TIMEOUT_MS) so a slow/hung provider call can never stall
 * a request indefinitely. `reasoning.effort: "low"` — kept unchanged across
 * the Groq switch; qwen/qwen3.8-27b (as served by Groq) supports this
 * effort value. "minimal" is never used (a mistake in an earlier round,
 * fixed since). "low" is the lowest value that still gives the model real
 * room for
 * Arabic/company-language understanding and correct tool selection, while
 * staying fast for these short, concrete business-data lookups (inventory/
 * sales/debt) — "none" risks degrading tool-call accuracy for the messier
 * queries (typos, mixed-language, ambiguous phrasing) this feature is
 * explicitly built to handle well. `strict: false` on every
 * function tool — this app's tool schemas have genuinely optional fields
 * (e.g. `limit?`), and OpenAI's strict function-calling mode requires every
 * property to be in `required` (using nullable types instead of optional),
 * which would mean reshaping every zod schema purely for this; non-strict
 * mode still validates argument shape via each tool's own zod schema in the
 * orchestrator regardless. Never logs the API key, the raw prompt, or the
 * raw response — only safe technical metadata on failure. */
export async function createOviAiResponse(options: ProviderRequestOptions): Promise<ProviderTurnResult> {
  const client = getClient();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), PROVIDER_TIMEOUT_MS);

  try {
    const response = await client.responses.create(
      {
        model: getModel(),
        instructions: options.instructions,
        input: options.input,
        tools: options.tools.map((tool) => ({
          type: "function" as const,
          name: tool.name,
          description: tool.description,
          parameters: tool.parameters,
          strict: false,
        })),
        max_output_tokens: MAX_OUTPUT_TOKENS,
        reasoning: { effort: "low" },
      },
      { signal: controller.signal },
    );

    const toolCalls: ProviderToolCall[] = response.output
      .filter((item): item is Extract<typeof item, { type: "function_call" }> => item.type === "function_call")
      .map((item) => ({ callId: item.call_id, name: item.name, argumentsJson: item.arguments }));

    return {
      outputText: response.output_text?.trim() || null,
      toolCalls,
      outputItems: response.output as ProviderInputItem[],
    };
  } catch (error) {
    // Safe technical metadata only — never the prompt/response body, never
    // the API key (the SDK itself never includes it in a thrown error).
    console.error("[ovi-ai] provider call failed", {
      aborted: controller.signal.aborted,
      message: error instanceof Error ? error.message : "unknown",
    });
    throw new OviAiProviderError("Ovi AI provider call failed", error);
  } finally {
    clearTimeout(timeout);
  }
}
