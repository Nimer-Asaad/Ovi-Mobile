import { Button } from "@/components/ui/Button";
import type { OviAiChip } from "@/lib/ai/types";

export interface SuggestionChipsProps {
  chips: OviAiChip[];
  onPick: (message: string) => void;
  disabled?: boolean;
}

/** Renders a row of tappable chips — used for both empty-state starter
 * questions, DB-backed disambiguation candidates, and post-answer follow-up
 * suggestions. Clicking one sends `chip.message` as a normal chat turn
 * (never a hidden/implicit action). */
export function SuggestionChips({ chips, onPick, disabled }: SuggestionChipsProps) {
  if (chips.length === 0) return null;

  return (
    <div className="flex flex-wrap gap-2">
      {chips.map((chip) => (
        <Button key={chip.label} type="button" variant="outline" size="sm" disabled={disabled} onClick={() => onPick(chip.message)}>
          {chip.label}
        </Button>
      ))}
    </div>
  );
}
