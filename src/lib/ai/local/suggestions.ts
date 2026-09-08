/** Small, deterministic set of contextually useful next-question chips —
 * built only from template phrases referencing ALREADY-RESOLVED real entity
 * labels already in context (never invented content). Ported from the
 * pre-local orchestrator's own buildFollowUpSuggestions, unchanged in
 * spirit — still the "what would a smart assistant ask next" layer, now
 * driven by the same context the local engine itself maintains. */

import type { OviAiChip, OviAiContext } from "@/lib/ai/types";

export function buildFollowUpSuggestions(context: OviAiContext): OviAiChip[] {
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
