"use server";

import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/auth/guards";
import { ADMIN_AUDIT_ACTIONS, ROLES } from "@/lib/constants";
import { runOviAiTurn } from "@/lib/ai/orchestrator";
import { EMPTY_OVI_AI_CONTEXT, type OviAiTurnResult } from "@/lib/ai/types";

/** V1 rate/cost safeguards — deliberately generous enough for real
 * questions but small enough to bound provider cost/latency per request.
 * See the feature report for the full list of chosen limits (tool-step cap
 * lives in orchestrator-core.ts). */
const MAX_MESSAGE_LENGTH = 800;
const MAX_HISTORY_ENTRIES = 8;
const MAX_HISTORY_MESSAGE_LENGTH = 2000;

/** Lightweight, in-process concurrency/rate guard keyed by the REAL
 * authenticated user id — deliberately NOT a database table (per the
 * explicit "do not create one for this" instruction): just two module-level
 * Maps that live for as long as this server process does, reset on
 * redeploy/restart, and are NOT shared across multiple server instances
 * behind a load balancer. Two independent protections:
 *   1. In-flight guard: rejects a second concurrent request from the same
 *      user while their first one is still being processed — prevents a
 *      double-click (or a runaway client retry loop) from firing two
 *      simultaneous, expensive provider calls for one person.
 *   2. Short cooldown: rejects a new request that starts within
 *      MIN_REQUEST_INTERVAL_MS of that same user's last request start —
 *      catches rapid-fire submissions the in-flight guard alone wouldn't
 *      (e.g. two clicks fast enough that the first hasn't been marked
 *      in-flight by the event loop yet).
 * Known limitation, explicitly accepted for V1: single-process only. On a
 * multi-instance deployment this only protects against a burst landing on
 * the SAME instance — acceptable for an internal admin tool's V1, and
 * upgradeable later (e.g. a real distributed limiter) without any schema
 * change if it's ever needed. */
const MIN_REQUEST_INTERVAL_MS = 800;
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

const sendMessageSchema = z.object({
  message: z.string().min(1, "الرسالة فارغة").max(MAX_MESSAGE_LENGTH, "الرسالة طويلة جداً"),
  history: z
    .array(z.object({ role: z.enum(["user", "assistant"]), content: z.string().max(MAX_HISTORY_MESSAGE_LENGTH) }))
    .max(MAX_HISTORY_ENTRIES)
    .default([]),
  context: contextSchema.default({}),
});

export interface SendOviAiMessageResult {
  ok: boolean;
  data?: OviAiTurnResult;
  error?: string;
}

/** Best-effort, non-blocking audit trail — logs ONLY that a query happened
 * (real admin id, role, a coarse intent category, timestamp), never the
 * message text or the assistant's reply. Reuses the existing AdminAuditLog
 * model as-is (no schema change — see the feature report's schema-
 * sufficiency confirmation); targetUserId is the same admin's own id (this
 * is a self-directed usage event, not an admin acting on another user, but
 * AdminAuditLog's schema has no separate "no target" shape, so the
 * convention here is target = self). Never awaited by the caller — a
 * logging failure must never break the chat response. */
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
 * only (server-enforced here — the page's own guard is a UX convenience,
 * never the real boundary, same convention as every other server action in
 * this app). Never throws a raw error to the client: any failure — bad
 * input, provider failure, tool failure — resolves to a safe, friendly
 * Arabic message instead.
 *
 * CLIENT CONTEXT TRUST: `parsed.data.context` is whatever the browser last
 * sent back — treated purely as a conversational HINT fed into the model's
 * instructions (see buildSystemPrompt), never as authorization and never as
 * unquestioned business truth. Every id it carries is only ever used by the
 * model to decide which tool to call next; the tool itself always re-loads
 * and re-validates that id fresh from the database (returns null/not-found
 * for a stale or tampered one), and the RETURNED context's labels always
 * come from that fresh tool result, never copied from the incoming one
 * unvalidated — see updateContextFromToolCalls in orchestrator-core.ts. */
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
      history: parsed.data.history,
      context: { ...EMPTY_OVI_AI_CONTEXT, ...parsed.data.context },
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
