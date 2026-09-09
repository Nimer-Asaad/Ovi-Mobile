/** Local, zero-provider autocomplete — real entity matches (via the same
 * bounded search_* tools the engine itself uses) plus a few useful query
 * templates built from the top match of each kind. Deliberately identity-
 * only: never touches quantities/debt/sales while the user is still typing
 * (see the module-level "AUTOCOMPLETE PERFORMANCE" requirement) — those
 * numbers are only ever fetched once a real message is sent through
 * runLocalOviTurn. Bounded, cheap, no network. */

import "server-only";
import { normalizeSearchText } from "@/lib/ai/normalization";
import { isPrefixOfAny, REP_WORDS, ACCOUNT_OVERVIEW_BARE_WORDS } from "@/lib/ai/language/lexicon";
import { searchCatalogCandidates } from "@/lib/ai/tools/catalog";
import { searchMerchants } from "@/lib/ai/tools/merchants";
import { searchReps } from "@/lib/ai/tools/reps";
import type { OviAiSuggestion } from "@/lib/ai/types";

const MIN_QUERY_LENGTH = 2;
const MAX_SUGGESTIONS = 8;
const MAX_ENTITY_MATCHES_PER_KIND = 3;

/** Recognizes a small set of PARTIAL business-language patterns while the
 * user is still typing (section 36) — "دفعات المن" or a bare "حساب" — and
 * returns real, useful QUERY suggestions for them without touching the DB
 * at all (never an expensive report execution during autocomplete, per the
 * module's own performance invariant). Pure/cheap; checked BEFORE the real
 * entity searches below so a recognized pattern never gets crowded out. */
function buildPartialPatternSuggestions(normalized: string, tokens: string[]): OviAiSuggestion[] {
  const hasPaymentsWording = normalized.includes(normalizeSearchText("دفع")) || normalized.includes(normalizeSearchText("قبض"));
  const hasRepPrefix = tokens.some((token) => isPrefixOfAny(token, REP_WORDS));
  if (hasPaymentsWording && hasRepPrefix) {
    return [
      { type: "QUERY", label: "دفعات المندوبين اليوم", query: "دفعات المندوبين اليوم" },
      { type: "QUERY", label: "دفعات المندوبين مبارح", query: "دفعات المندوبين مبارح" },
      { type: "QUERY", label: "دفعات المندوبين هالشهر", query: "دفعات المندوبين هالشهر" },
      { type: "QUERY", label: "دفعات مندوب معين", query: "دفعات مندوب" },
    ];
  }

  const lastToken = tokens[tokens.length - 1] ?? "";
  if (ACCOUNT_OVERVIEW_BARE_WORDS.map(normalizeSearchText).includes(lastToken)) {
    return [
      { type: "QUERY", label: "حساب التجار", query: "حساب التجار" },
      { type: "QUERY", label: "أعلى الذمم", query: "مين عليه أكثر؟" },
    ];
  }

  return [];
}

export async function getLocalAutocompleteSuggestions(rawQuery: string): Promise<OviAiSuggestion[]> {
  const query = rawQuery.trim();
  if (query.length < MIN_QUERY_LENGTH) return [];

  const partialPatternSuggestions = buildPartialPatternSuggestions(normalizeSearchText(query), normalizeSearchText(query).split(" ").filter(Boolean));
  if (partialPatternSuggestions.length > 0) return partialPatternSuggestions.slice(0, MAX_SUGGESTIONS);

  const [catalog, merchants, reps] = await Promise.all([
    searchCatalogCandidates(query, 6).catch(() => ({ candidates: [] as Awaited<ReturnType<typeof searchCatalogCandidates>>["candidates"], recommendedAction: "NO_MATCH" as const })),
    searchMerchants(query, 4).catch(() => ({ candidates: [] as Awaited<ReturnType<typeof searchMerchants>>["candidates"], recommendedAction: "NO_MATCH" as const })),
    searchReps(query, 4).catch(() => ({ candidates: [] as Awaited<ReturnType<typeof searchReps>>["candidates"], recommendedAction: "NO_MATCH" as const })),
  ]);

  const suggestions: OviAiSuggestion[] = [];

  const topCatalog = catalog.candidates.slice(0, MAX_ENTITY_MATCHES_PER_KIND);
  for (const candidate of topCatalog) {
    suggestions.push({ type: "ENTITY", label: candidate.label, query: `شو عنا ${candidate.label}؟`, entityId: candidate.targetId, entityType: candidate.targetType });
  }
  const bestCatalog = topCatalog[0];
  if (bestCatalog) {
    suggestions.push({ type: "QUERY", label: `وين موجود ${bestCatalog.label}؟`, query: `وين موجود ${bestCatalog.label}؟` });
    suggestions.push({ type: "QUERY", label: `مين معه ${bestCatalog.label} بالسيارات؟`, query: `مين معه ${bestCatalog.label} بالسيارات؟` });
    suggestions.push({ type: "QUERY", label: `مبيعات ${bestCatalog.label} هذا الشهر`, query: `كم بعنا ${bestCatalog.label} هالشهر؟` });
  }

  const topMerchants = merchants.candidates.slice(0, MAX_ENTITY_MATCHES_PER_KIND);
  for (const candidate of topMerchants) {
    suggestions.push({ type: "ENTITY", label: candidate.subLabel ? `${candidate.label} — ${candidate.subLabel}` : candidate.label, query: `كم على ${candidate.label}؟`, entityId: candidate.merchantId, entityType: "MERCHANT" });
  }
  const bestMerchant = topMerchants[0];
  if (bestMerchant) {
    suggestions.push({ type: "QUERY", label: "آخر دفعة", query: `آخر دفعة لـ ${bestMerchant.label} متى؟` });
  }

  const topReps = reps.candidates.slice(0, MAX_ENTITY_MATCHES_PER_KIND);
  for (const candidate of topReps) {
    suggestions.push({ type: "ENTITY", label: candidate.label, query: `شو معه ${candidate.label} بالسيارة؟`, entityId: candidate.repId, entityType: "REP" });
  }
  const bestRep = topReps[0];
  if (bestRep) {
    suggestions.push({ type: "QUERY", label: `مبيعات ${bestRep.label} اليوم`, query: `كم باع ${bestRep.label} اليوم؟` });
  }

  return suggestions.slice(0, MAX_SUGGESTIONS);
}
