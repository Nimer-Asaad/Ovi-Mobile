/** Client-only "local learning" store — a bounded list of user-CONFIRMED
 * disambiguation picks kept in the browser's own localStorage, never sent
 * anywhere except back to this app's own server as an optional ranking hint
 * (see OviAiLearnedAlias in src/lib/ai/types.ts, and resolveEntity's
 * `learnedHint` parameter for how the server treats it as untrusted). Only
 * ever written from an explicit candidate-chip click — never from typing
 * alone. Stores entity-resolution aliases ONLY: never quantities, prices,
 * merchant debt, payments, or any other business figure. */

import type { OviAiLearnedAlias } from "@/lib/ai/types";

const STORAGE_KEY = "ovi-ai-learned-aliases-v1";
const MAX_ALIASES = 80;

function isValidAlias(value: unknown): value is OviAiLearnedAlias {
  if (!value || typeof value !== "object") return false;
  const alias = value as Record<string, unknown>;
  return (
    typeof alias.normalizedPhrase === "string" &&
    typeof alias.entityId === "string" &&
    typeof alias.entityType === "string" &&
    typeof alias.label === "string" &&
    typeof alias.createdAt === "number"
  );
}

/** Never throws — a private browser window, cleared site data, or a
 * blocked storage accessor must never break the chat itself; every caller
 * gets a safe empty/no-op fallback instead. */
export function loadLearnedAliases(): OviAiLearnedAlias[] {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter(isValidAlias) : [];
  } catch {
    return [];
  }
}

export function saveLearnedAlias(alias: OviAiLearnedAlias): void {
  try {
    const key = alias.normalizedPhrase.trim().toLowerCase();
    const existing = loadLearnedAliases().filter((entry) => entry.normalizedPhrase.trim().toLowerCase() !== key);
    const next = [alias, ...existing].slice(0, MAX_ALIASES);
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {
    // Storage unavailable — learning is a nice-to-have, never block chat.
  }
}

/** Simple case-insensitive exact-phrase lookup — the server re-normalizes
 * (normalizeSearchText) both sides again before ever trusting a match, so
 * this client-side comparison doesn't need to be linguistically exact, only
 * a reasonable pre-filter. */
export function findLearnedAlias(message: string): OviAiLearnedAlias | null {
  try {
    const target = message.trim().toLowerCase();
    if (!target) return null;
    return loadLearnedAliases().find((alias) => alias.normalizedPhrase.trim().toLowerCase() === target) ?? null;
  } catch {
    return null;
  }
}

export function clearLearnedAliases(): void {
  try {
    window.localStorage.removeItem(STORAGE_KEY);
  } catch {
    // ignore
  }
}
