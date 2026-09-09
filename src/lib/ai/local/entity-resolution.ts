/** Local-engine entity resolution — Stage 2 of the two-stage pattern (a
 * bounded DB candidate search already ran inside the search_* tool; this
 * module decides RESOLVED/AMBIGUOUS/NOT_FOUND from those real results,
 * optionally boosted by a client-supplied "learned alias" hint). Never
 * invents an id: every RESOLVED/AMBIGUOUS/NOT_FOUND candidate here traces
 * back to a real row the search tool's own DB query just read. */

import "server-only";
import { toMatchable } from "@/lib/ai/language/dialect";
import { classifyCandidates, CONFIDENCE_BANDS, type ConfidenceAction, type MatchType } from "@/lib/ai/fuzzy";
import { searchCatalogCandidates } from "@/lib/ai/tools/catalog";
import { searchMerchants } from "@/lib/ai/tools/merchants";
import { searchReps } from "@/lib/ai/tools/reps";
import type { OviAiChip, OviAiContext } from "@/lib/ai/types";
import type { EntityKindHint, EntityResolutionResult, LearnedHintInput, ResolvedEntityType } from "@/lib/ai/local/types";

/** How much a matching learned alias amplifies a candidate's score — large
 * enough to flip a previously-confirmed ASK_USER pick into AUTO_RESOLVE next
 * time. Deliberately NOT capped at 100 when applied (see boostWithLearnedHint
 * below): scoreCandidateLabel's own MODEL_CODE_MATCH_BONUS already pushes a
 * strong exact-code match to the 100 ceiling, so two genuinely tied
 * candidates (e.g. "A26 Ultra" vs "S26 Ultra" for a bare "26 ultra" query,
 * both ~88) would have their bonus SWALLOWED by a 100-cap — 88+20 capped at
 * 100 only ever opens an 12-point gap against an 88 runner-up, permanently
 * short of CONFIDENCE_BANDS.CLEAR_GAP (15). Left uncapped, this is purely an
 * internal ranking value from here on (never shown to the user as a raw
 * score), so there is nothing an uncapped value could corrupt. It never
 * substitutes for a real candidate — see the SECURITY note above. */
const LEARNED_HINT_BONUS = 20;

interface ScoredCandidate {
  id: string;
  type: ResolvedEntityType;
  label: string;
  score: number;
  matchType: MatchType;
}

/** SECURITY: the hint is applied ONLY when (1) its recorded phrase matches
 * the CURRENT message (never generalizes to a different question) and (2)
 * its entityId+entityType exactly match one of the candidates THIS search
 * just returned from the database. A tampered/stale localStorage entry
 * whose id doesn't appear among the real results has zero effect — it can
 * never inject a fact the search didn't already surface (see Test 13: the
 * server "revalidates" simply by never trusting the hint's id in isolation).
 *
 * The phrase comparison uses `toMatchable` (language/dialect.ts) rather
 * than plain normalizeSearchText — a user who confirmed "a 26 altra" once
 * gets the same learned boost from "A-26 ALTRA" or "أ 26 التراء" next time
 * (hamza/alef-maksura + separator/case variance folded away), matching
 * section 35's explicit "after normalization/dialect canonicalization"
 * requirement. Still only ever an amplifier over a REAL candidate this
 * search already found — never a shortcut around resolution itself. */
function boostWithLearnedHint(candidates: ScoredCandidate[], hint: LearnedHintInput | null, rawMessage: string): ScoredCandidate[] {
  if (!hint) return candidates;
  if (toMatchable(hint.normalizedPhrase) !== toMatchable(rawMessage)) return candidates;
  let matched = false;
  const boosted = candidates.map((candidate) => {
    if (candidate.id === hint.entityId && candidate.type === hint.entityType) {
      matched = true;
      return { ...candidate, score: candidate.score + LEARNED_HINT_BONUS };
    }
    return candidate;
  });
  return matched ? boosted : candidates;
}

function finalizeResolution(candidates: ScoredCandidate[]): EntityResolutionResult {
  const sorted = [...candidates].sort((a, b) => b.score - a.score);
  const action: ConfidenceAction = classifyCandidates(sorted.map((c) => ({ score: c.score, matchType: c.matchType })));
  if (action === "AUTO_RESOLVE") {
    const top = sorted[0]!;
    return { status: "RESOLVED", type: top.type, id: top.id, label: top.label };
  }
  // A genuine ASK_USER disambiguation only ever shows candidates that
  // themselves cleared ASK_THRESHOLD — the same floor classifyCandidates
  // uses to judge the TOP candidate "real enough to ask about" at all.
  // Without this, a handful of barely-related rows that merely scored
  // above 0 (e.g. one weak, unrelated token match) could ride along in the
  // same clarification list as the genuinely close candidates, which the
  // old LLM-mediated system implicitly filtered out via its own judgment —
  // a purely deterministic UI has no such judgment, so it filters here
  // instead. NOT_FOUND deliberately skips this floor: those ARE the
  // "closest real candidates we have, even though none are a good match"
  // the spec explicitly asks for.
  const relevant = action === "ASK_USER" ? sorted.filter((c) => c.score >= CONFIDENCE_BANDS.ASK_THRESHOLD) : sorted;
  const chips: OviAiChip[] = relevant.slice(0, 6).map((c) => ({ label: c.label, message: c.label, entityId: c.id, entityType: c.type }));
  return { status: action === "ASK_USER" ? "AMBIGUOUS" : "NOT_FOUND", candidates: chips.length > 0 ? chips : undefined };
}

async function resolveCatalog(entityQuery: string, hint: LearnedHintInput | null, rawMessage: string): Promise<EntityResolutionResult> {
  const result = await searchCatalogCandidates(entityQuery);
  const scored: ScoredCandidate[] = result.candidates.map((c) => ({ id: c.targetId, type: c.targetType, label: c.label, score: c.score, matchType: c.matchType }));
  return finalizeResolution(boostWithLearnedHint(scored, hint, rawMessage));
}

async function resolveMerchant(entityQuery: string, hint: LearnedHintInput | null, rawMessage: string): Promise<EntityResolutionResult> {
  const result = await searchMerchants(entityQuery);
  const scored: ScoredCandidate[] = result.candidates.map((c) => ({ id: c.merchantId, type: "MERCHANT", label: c.label, score: c.score, matchType: c.matchType }));
  return finalizeResolution(boostWithLearnedHint(scored, hint, rawMessage));
}

async function resolveRep(entityQuery: string, hint: LearnedHintInput | null, rawMessage: string): Promise<EntityResolutionResult> {
  const result = await searchReps(entityQuery);
  const scored: ScoredCandidate[] = result.candidates.map((c) => ({ id: c.repId, type: "REP", label: c.label, score: c.score, matchType: c.matchType }));
  return finalizeResolution(boostWithLearnedHint(scored, hint, rawMessage));
}

export interface ResolveEntityParams {
  entityKind: EntityKindHint;
  entityQuery: string;
  rawMessage: string;
  context: OviAiContext;
  learnedHint: LearnedHintInput | null;
}

/** The local engine's single entity-resolution entry point. `entityQuery`
 * empty means the message named no new entity — reuse whatever's already
 * resolved in context (the actual capability tool re-validates that id
 * fresh from the DB regardless, so a stale context id just resolves to
 * "not found" downstream, never a fabricated fact). `AMBIGUOUS_NAME` tries a
 * rep search first, falling back to a catalog search only when no real rep
 * candidate exists — see router.ts's own doc comment for why. */
export async function resolveEntity(params: ResolveEntityParams): Promise<EntityResolutionResult> {
  const { entityKind, entityQuery, rawMessage, context, learnedHint } = params;

  if (entityKind === "NONE") return { status: "NOT_NEEDED" };

  if (entityQuery.trim().length === 0) {
    if (entityKind === "CATALOG") {
      if (context.resolvedProductId) return { status: "RESOLVED", type: "PRODUCT", id: context.resolvedProductId, label: context.resolvedProductLabel ?? "" };
      if (context.resolvedPhoneModelId) return { status: "RESOLVED", type: "PHONE_MODEL", id: context.resolvedPhoneModelId, label: context.resolvedPhoneModelLabel ?? "" };
    }
    if (entityKind === "MERCHANT" && context.resolvedMerchantId) {
      return { status: "RESOLVED", type: "MERCHANT", id: context.resolvedMerchantId, label: context.resolvedMerchantLabel ?? "" };
    }
    if ((entityKind === "REP" || entityKind === "AMBIGUOUS_NAME" || entityKind === "REP_THEN_MERCHANT") && context.resolvedRepId) {
      return { status: "RESOLVED", type: "REP", id: context.resolvedRepId, label: context.resolvedRepLabel ?? "" };
    }
    if (entityKind === "REP_THEN_MERCHANT" && context.resolvedMerchantId) {
      return { status: "RESOLVED", type: "MERCHANT", id: context.resolvedMerchantId, label: context.resolvedMerchantLabel ?? "" };
    }
    return { status: "NOT_FOUND" };
  }

  if (entityKind === "CATALOG") return resolveCatalog(entityQuery, learnedHint, rawMessage);
  if (entityKind === "MERCHANT") return resolveMerchant(entityQuery, learnedHint, rawMessage);
  if (entityKind === "REP") return resolveRep(entityQuery, learnedHint, rawMessage);

  if (entityKind === "REP_THEN_MERCHANT") {
    // "احمد كم قبض اليوم؟" — قبض/تحصيل tied to a name almost always means
    // THAT rep's own collected payments in this business (a merchant never
    // "قبض"s), so a real rep candidate always wins first; only fall back to
    // a merchant search when no real rep of that name exists at all — see
    // router.ts's own doc comment on why "قبض"/"تحصيل" and "دفع"/"سدد" are
    // never treated as interchangeable directions.
    const repAttempt = await resolveRep(entityQuery, learnedHint, rawMessage);
    if (repAttempt.status === "RESOLVED" || repAttempt.status === "AMBIGUOUS") return repAttempt;
    return resolveMerchant(entityQuery, learnedHint, rawMessage);
  }

  const repAttempt = await resolveRep(entityQuery, learnedHint, rawMessage);
  if (repAttempt.status === "RESOLVED" || repAttempt.status === "AMBIGUOUS") return repAttempt;
  return resolveCatalog(entityQuery, learnedHint, rawMessage);
}
