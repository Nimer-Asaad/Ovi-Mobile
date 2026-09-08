import "server-only";
import { runLocalOviTurn, type LocalTurnInput } from "@/lib/ai/local/engine";
import type { OviAiTurnResult } from "@/lib/ai/types";

/** Ovi AI's server-only entry point. Ovi AI local V1 has NO generative
 * provider anywhere in this app — this file used to wire a real OpenAI/Groq
 * provider + an LLM tool-calling loop into an orchestrator-core; both are
 * gone. It now does nothing but call the local, deterministic engine (see
 * src/lib/ai/local/engine.ts): UI -> server action (src/app/admin/ai/
 * actions.ts) -> this file -> local engine -> router/entity-resolution ->
 * typed Ovi capability -> canonical Ovi helper -> Prisma -> DB -> structured
 * response. No network call, no AI SDK, no API key, anywhere in this path. */

const FRIENDLY_ERROR_MESSAGE = "صار خلل مؤقت بالمساعد، جرّب مرة ثانية.";

export type { LocalTurnInput as OrchestratorInput };

/** Runs one full Ovi AI turn. Never throws to the caller — any failure
 * resolves to a safe, friendly Arabic message via the local engine's own
 * try/catch; this outer catch is a defensive backstop only. */
export async function runOviAiTurn(input: LocalTurnInput): Promise<OviAiTurnResult> {
  try {
    return await runLocalOviTurn(input);
  } catch (error) {
    console.error("[ovi-ai] runOviAiTurn failed", { message: error instanceof Error ? error.message : "unknown" });
    return { response: { kind: "ERROR", summary: FRIENDLY_ERROR_MESSAGE }, context: input.context, suggestions: [] };
  }
}
