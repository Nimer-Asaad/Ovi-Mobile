import "server-only";
import { z } from "zod";
import { createOviAiResponse, buildMessageItem, buildFunctionCallOutputItem, type ProviderInputItem } from "@/lib/ai/provider";
import { buildSystemPrompt } from "@/lib/ai/system-prompt";
import { OVI_AI_TOOLS } from "@/lib/ai/tools/index";
import { getBusinessDateIso } from "@/lib/reporting";
import { runOrchestratorTurn, type CoreToolDefinition, type CoreToolRegistryEntry, type OrchestratorInput } from "@/lib/ai/orchestrator-core";
import type { OviAiTurnResult } from "@/lib/ai/types";

/** Ovi AI orchestrator — the thin, server-only wrapper that plugs the REAL
 * OpenAI provider (src/lib/ai/provider.ts) and the REAL tool registry
 * (src/lib/ai/tools/index.ts) into orchestrator-core.ts's actual control
 * flow via dependency injection. Architecture: UI -> server action ->
 * orchestrator (this file, wiring) -> orchestrator-core (the real loop) ->
 * tool router (OVI_AI_TOOLS) -> canonical Ovi helpers -> Prisma -> DB. The
 * model never receives DB credentials, never sees a raw SQL string, and has
 * no tool capable of writing anything — see OVI_AI_TOOLS' own doc comment.
 * Conversation "storage" is entirely request-scoped (see the feature
 * report — no schema change for chat history in V1). */

const FRIENDLY_ERROR_MESSAGE = "صار خلل مؤقت بالمساعد، جرّب مرة ثانية.";

function buildToolDefinitions(): CoreToolDefinition[] {
  return Object.entries(OVI_AI_TOOLS).map(([name, tool]) => {
    const jsonSchema = z.toJSONSchema(tool.schema) as Record<string, unknown>;
    delete jsonSchema.$schema;
    return { name, description: tool.description, parameters: jsonSchema };
  });
}

const TOOL_DEFINITIONS = buildToolDefinitions();
// Structurally identical to CoreToolRegistryEntry (description/schema/
// execute) — OVI_AI_TOOLS' own per-tool arg types are intentionally exact
// (never `never`); this is the one place that widens them for the
// provider-agnostic core, which only ever calls `execute` with args its own
// zod-validated `schema.safeParse` already produced for that same tool.
const TOOL_REGISTRY = OVI_AI_TOOLS as unknown as Record<string, CoreToolRegistryEntry>;

/** Runs one full Ovi AI turn. Never throws to the caller — any failure
 * (provider, tool, or unexpected) resolves to a safe, friendly Arabic
 * message via orchestrator-core's own try/catch; this outer catch is a
 * defensive backstop only. */
export async function runOviAiTurn(input: OrchestratorInput): Promise<OviAiTurnResult> {
  try {
    return await runOrchestratorTurn<ProviderInputItem>(input, {
      chat: createOviAiResponse,
      buildMessageItem,
      buildToolResultItem: buildFunctionCallOutputItem,
      tools: TOOL_REGISTRY,
      toolDefinitions: TOOL_DEFINITIONS,
      buildInstructions: buildSystemPrompt,
      todayIso: getBusinessDateIso(),
    });
  } catch (error) {
    console.error("[ovi-ai] runOviAiTurn failed", { message: error instanceof Error ? error.message : "unknown" });
    return { reply: FRIENDLY_ERROR_MESSAGE, context: input.context, suggestions: [] };
  }
}
