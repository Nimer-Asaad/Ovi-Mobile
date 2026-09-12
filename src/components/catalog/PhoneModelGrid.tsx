"use client";

import { useMemo, useState } from "react";
import { cn } from "@/lib/utils";
import { groupAndSortModels, modelLabelMatchesQuery, type GroupableModel } from "@/lib/phone-model-grouping";

interface PhoneModelGridProps<T extends GroupableModel> {
  models: T[];
  selectedModelId: string | null;
  onSelect: (modelId: string) => void;
}

/** Storefront-only phone-model picker: groups a brand's models by family
 * (سلسلة A/S/J/M, iPhone, أخرى), natural-sorts within each group, and offers
 * a client-side search — all purely presentational. Every chip's onClick
 * still calls onSelect(model.id) with the SAME real PhoneModel id the flat
 * list used to pass; grouping/search never changes what gets selected. */
export function PhoneModelGrid<T extends GroupableModel>({ models, selectedModelId, onSelect }: PhoneModelGridProps<T>) {
  const [query, setQuery] = useState("");
  const groups = useMemo(() => groupAndSortModels(models), [models]);
  const visibleGroups = useMemo(() => {
    if (!query.trim()) return groups;
    return groups
      .map((group) => ({ ...group, models: group.models.filter((model) => modelLabelMatchesQuery(model.nameAr ?? model.name, query)) }))
      .filter((group) => group.models.length > 0);
  }, [groups, query]);

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-sm text-neutral-bg/70">الموديل</p>
      </div>
      <input
        type="text"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        placeholder="ابحث عن الموديل..."
        aria-label="ابحث عن الموديل"
        className="w-full rounded-card border border-navy-soft bg-transparent px-3 py-2 text-sm text-neutral-bg placeholder:text-neutral-bg/40 focus:border-gold-champagne focus:outline-none"
      />
      {visibleGroups.length === 0 ? (
        <p className="text-sm text-neutral-bg/50">لا يوجد موديل مطابق للبحث.</p>
      ) : (
        <div className="space-y-4">
          {visibleGroups.map((group) => (
            <div key={group.label}>
              <p className="mb-2 text-xs font-medium uppercase tracking-wide text-neutral-bg/40">{group.label}</p>
              {/* auto-fill/minmax sizes columns to the panel's REAL available
                  width (which shrinks at the `lg` breakpoint when the page
                  switches to a 2-column layout) instead of the viewport —
                  viewport-keyed breakpoints would overcrowd the narrower
                  column at lg/xl. 110px (up from 84px) gives a long label
                  like "iPhone 14 Pro Max" room to wrap onto two clean lines
                  instead of a single cramped one. */}
              <div className="grid grid-cols-[repeat(auto-fill,minmax(110px,1fr))] gap-2">
                {group.models.map((model) => {
                  const isSelected = model.id === selectedModelId;
                  const label = model.nameAr ?? model.name;
                  // Only force LTR for a predominantly Latin/numeric code
                  // (e.g. "A17/A26") — a real Arabic nameAr label stays
                  // direction-neutral so it renders naturally in the RTL page.
                  const isLatinCode = !/[؀-ۿ]/.test(label);
                  return (
                    <button
                      key={model.id}
                      type="button"
                      aria-pressed={isSelected}
                      onClick={() => onSelect(model.id)}
                      className={cn(
                        "min-h-10 min-w-0 rounded-card border px-2 py-2 text-sm transition-colors",
                        isSelected
                          ? "border-gold-champagne bg-gold-champagne/15 text-gold-light"
                          : "border-navy-soft text-neutral-bg/70 hover:border-gold-champagne/40",
                      )}
                      title={label}
                    >
                      <span dir={isLatinCode ? "ltr" : undefined} className="block w-full whitespace-normal break-words text-center leading-snug">
                        {label}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
