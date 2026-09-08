"use server";

import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/auth/guards";
import { ADMIN_AUDIT_ACTIONS, ROLES } from "@/lib/constants";
import { runOviAiTurn } from "@/lib/ai/orchestrator";
import { getLocalAutocompleteSuggestions } from "@/lib/ai/local/autocomplete";
import { EMPTY_OVI_AI_CONTEXT, type OviAiSuggestion, type OviAiTurnResult } from "@/lib/ai/types";

/** V1 rate/DB-load safeguards — Ovi AI local V1 has no provider cost/latency
 * to bound anymore, but a burst of clicks can still fire redundant DB
 * queries, so the same lightweight guard is kept. */
const MAX_MESSAGE_LENGTH = 800;
const MAX_AUTOCOMPLETE_QUERY_LENGTH = 60;

/** Lightweight, in-process concurrency/rate guard keyed by the REAL
 * authenticated user id — deliberately NOT a database table: two module-
 * level Maps that live for as long as this server process does, reset on
 * redeploy/restart, and are NOT shared across multiple server instances
 * behind a load balancer (an accepted V1 limitation, same as before). */
const MIN_REQUEST_INTERVAL_MS = 400;
const inFlightUserIds = new Set<string>();
const lastRequestStartedAtByUserId = new Map<string, number>();

const contextSchema = z
  .object({
    resolvedProductId: z.string().nullable().optional(),
    resolvedProductLabel: z.string().nullable().optional(),
    resolvedPhoneModelId: z.string().nullable().optional(),
    resolvedPhoneModelLabel: z.string().nullable().optional(),
    resolvedMerchantId: z.string().nullable().optional(),
    resolvedMerchantLabel: z.string().nullable().optional(),
    resolvedRepId: z.string().nullable().optional(),
    resolvedRepLabel: z.string().nullable().optional(),
    lastIntent: z.string().nullable().optional(),
    period: z.object({ fromIso: z.string(), toIso: z.string(), label: z.string() }).nullable().optional(),
  })
  .partial();

/** A user-confirmed disambiguation pick, read back from the browser's own
 * localStorage (see OviAiLearnedAlias in src/lib/ai/types.ts) — treated as
 * an untrusted ranking HINT only; the local engine's resolveEntity never
 * trusts entityId in isolation, only ever amplifying a candidate its own
 * fresh DB search this turn already found (see entity-resolution.ts). */
const learnedHintSchema = z
  .object({
    normalizedPhrase: z.string().max(400),
    entityId: z.string().min(1).max(100),
    entityType: z.enum(["PRODUCT", "PHONE_MODEL", "MERCHANT", "REP"]),
  })
  .nullable()
  .optional();

const sendMessageSchema = z.object({
  message: z.string().min(1, "الرسالة فارغة").max(MAX_MESSAGE_LENGTH, "الرسالة طويلة جداً"),
  context: contextSchema.default({}),
  learnedHint: learnedHintSchema,
});

export interface SendOviAiMessageResult {
  ok: boolean;
  data?: OviAiTurnResult;
  error?: string;
}

/** Best-effort, non-blocking audit trail — logs ONLY that a query happened
 * (real admin id, role, a coarse intent category, timestamp), never the
 * message text or the assistant's reply. Reuses the existing AdminAuditLog
 * model as-is (no schema change). Never awaited by the caller — a logging
 * failure must never break the chat response. */
function logOviAiUsage(adminUserId: string, role: string, intentCategory: string): void {
  prisma.adminAuditLog
    .create({
      data: {
        adminUserId,
        targetUserId: adminUserId,
        action: ADMIN_AUDIT_ACTIONS.OVI_AI_QUERY,
        newValue: { role, intentCategory },
      },
    })
    .catch((error) => {
      console.error("[ovi-ai] usage audit log failed", { message: error instanceof Error ? error.message : "unknown" });
    });
}

/** The one entry point the chat UI calls per turn. ADMIN/ADMIN_ASSISTANT
 * only (server-enforced here). Never throws a raw error to the client: any
 * failure — bad input, DB failure — resolves to a safe, friendly Arabic
 * message instead.
 *
 * CLIENT CONTEXT TRUST: `parsed.data.context` is whatever the browser last
 * sent back — treated purely as conversational memory, never as
 * authorization and never as unquestioned business truth. Every id it
 * carries is only ever fed to a tool that re-loads and re-validates it
 * fresh from the database (returns null/not-found for a stale or tampered
 * one); the RETURNED context's labels always come from that fresh tool
 * result, never copied from the incoming one unvalidated. `learnedHint`
 * gets the same treatment (see resolveEntity in local/entity-resolution.ts). */
export async function sendOviAiMessage(input: unknown): Promise<SendOviAiMessageResult> {
  const user = await requireRole([ROLES.ADMIN, ROLES.ADMIN_ASSISTANT]);

  if (inFlightUserIds.has(user.id)) {
    return { ok: false, error: "في طلب قيد المعالجة حالياً، انتظر لحظة." };
  }
  const lastStartedAt = lastRequestStartedAtByUserId.get(user.id);
  if (lastStartedAt !== undefined && Date.now() - lastStartedAt < MIN_REQUEST_INTERVAL_MS) {
    return { ok: false, error: "لا تكثر من الطلبات، انتظر لحظة." };
  }

  const parsed = sendMessageSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: "الرسالة غير صالحة" };
  }

  inFlightUserIds.add(user.id);
  lastRequestStartedAtByUserId.set(user.id, Date.now());

  try {
    const result = await runOviAiTurn({
      message: parsed.data.message,
      context: { ...EMPTY_OVI_AI_CONTEXT, ...parsed.data.context },
      learnedHint: parsed.data.learnedHint ?? null,
    });

    logOviAiUsage(user.id, user.role, result.context.lastIntent ?? "GENERAL");

    return { ok: true, data: result };
  } catch (error) {
    console.error("[ovi-ai] sendOviAiMessage failed", { message: error instanceof Error ? error.message : "unknown" });
    return { ok: false, error: "صار خلل مؤقت بالمساعد، جرّب مرة ثانية." };
  } finally {
    inFlightUserIds.delete(user.id);
  }
}

export interface GetOviAiAutocompleteResult {
  ok: boolean;
  data?: OviAiSuggestion[];
}

/** Autocomplete-while-typing entry point — role-gated exactly like
 * sendOviAiMessage, but never runs through the local engine/router at all:
 * it only ever calls the bounded, identity-only search tools (see
 * local/autocomplete.ts), never a quantity/debt/sales tool, and never
 * writes an audit log entry (this is not a real question, just a
 * suggestion list). Fails closed to an empty list on any error — a broken
 * autocomplete must never surface as a visible error to the user. */
export async function getOviAiAutocomplete(input: unknown): Promise<GetOviAiAutocompleteResult> {
  await requireRole([ROLES.ADMIN, ROLES.ADMIN_ASSISTANT]);

  const parsed = z.string().max(MAX_AUTOCOMPLETE_QUERY_LENGTH).safeParse(input);
  if (!parsed.success) return { ok: true, data: [] };

  try {
    const data = await getLocalAutocompleteSuggestions(parsed.data);
    return { ok: true, data };
  } catch (error) {
    console.error("[ovi-ai] getOviAiAutocomplete failed", { message: error instanceof Error ? error.message : "unknown" });
    return { ok: true, data: [] };
  }
}
