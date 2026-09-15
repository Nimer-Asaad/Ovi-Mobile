"use client";

import { useActionState, useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { formatCurrencyFromCents } from "@/lib/utils";
import { ONLINE_SALE_CATEGORY_CONFIG, ONLINE_SALE_CATEGORY_ORDER, calculateCommissionCents, formatCommissionRateLabel } from "@/lib/online-sales";
import { saveOnlineSalesAction, type SaveOnlineSalesState } from "@/app/admin/online/actions";
import type { OnlineSaleCategory } from "@/types";

type AmountInputs = Record<OnlineSaleCategory, string>;

const EMPTY_AMOUNTS: AmountInputs = { WHOLESALE: "", SUPER_WHOLESALE: "", RETAIL: "" };

const CATEGORY_FORM_FIELD: Record<OnlineSaleCategory, string> = {
  WHOLESALE: "wholesaleAmountCents",
  SUPER_WHOLESALE: "superWholesaleAmountCents",
  RETAIL: "retailAmountCents",
};

/** Strips any "-" the user types/pastes so a field can never hold a
 * negative amount — same approach as the calculator's original version. */
function stripNegativeSign(raw: string): string {
  return raw.replace(/-/g, "");
}

/** Live, unsaved preview only — parses a raw amount input into
 * non-negative integer cents purely for the "النسبة المتوقعة" preview
 * below. Blank/invalid text previews as zero; this never touches the
 * database. The actual save (saveOnlineSalesAction) re-parses and
 * recalculates the exact same way server-side and never trusts this
 * preview's numbers. */
function toPreviewCents(rawValue: string): number {
  const parsed = Number(rawValue);
  if (!rawValue.trim() || !Number.isFinite(parsed) || parsed < 0) return 0;
  return Math.round(parsed * 100);
}

const initialState: SaveOnlineSalesState = {};

export interface OnlineSaleEntryFormProps {
  /** Today's Palestine business-local date ("YYYY-MM-DD") — the entry
   * form's default and the browser-level `max` on the date input (a UX
   * hint only; the actual future-date rejection happens server-side in
   * saveOnlineSalesAction, never trusted from the client). */
  todayIso: string;
}

/** Entry form for one calendar day's online sales, across the three fixed
 * commission categories — the "add" half of the أون لاين ledger (see
 * OnlineSalesHistoryTable for the "view saved records" half). Every
 * commission shown here before saving is a live, unsaved preview
 * ("النسبة المتوقعة") — the server recalculates authoritatively from the
 * canonical rates at save time and never trusts a number sent from here
 * (see saveOnlineSalesAction). */
export function OnlineSaleEntryForm({ todayIso }: OnlineSaleEntryFormProps) {
  const [state, formAction, isPending] = useActionState(saveOnlineSalesAction, initialState);
  const [saleDate, setSaleDate] = useState(todayIso);
  const [amounts, setAmounts] = useState<AmountInputs>(EMPTY_AMOUNTS);

  // Clear the amount fields after every successful save, but keep the
  // selected date so the admin can immediately log another entry for the
  // same historical day. Keyed on submissionId (not state.success's text)
  // so two consecutive saves with the identical success message both still
  // clear the fields — a plain string dependency wouldn't re-fire the
  // second time since its value wouldn't have changed.
  useEffect(() => {
    if (state.submissionId) setAmounts(EMPTY_AMOUNTS);
  }, [state.submissionId]);

  function handleAmountChange(category: OnlineSaleCategory, rawValue: string) {
    setAmounts((current) => ({ ...current, [category]: stripNegativeSign(rawValue) }));
  }

  function handleClearAmounts() {
    setAmounts(EMPTY_AMOUNTS);
  }

  return (
    <form action={formAction} className="flex flex-col gap-6">
      <Card>
        <CardHeader>
          <CardTitle>التاريخ</CardTitle>
        </CardHeader>
        <CardContent>
          <Input
            name="saleDate"
            type="date"
            dir="ltr"
            max={todayIso}
            value={saleDate}
            onChange={(event) => setSaleDate(event.target.value)}
            className="max-w-xs"
          />
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        {ONLINE_SALE_CATEGORY_ORDER.map((category) => {
          const { labelAr, rateBps } = ONLINE_SALE_CATEGORY_CONFIG[category];
          const previewCents = toPreviewCents(amounts[category]);
          const previewCommissionCents = calculateCommissionCents(previewCents, rateBps);

          return (
            <Card key={category}>
              <CardHeader>
                <CardTitle>{labelAr}</CardTitle>
              </CardHeader>
              <CardContent className="flex flex-col gap-4">
                <div className="flex items-center justify-between">
                  <span className="text-neutral-bg/60">نسبة العمولة</span>
                  <span className="font-semibold text-neutral-bg" dir="ltr">
                    {formatCommissionRateLabel(rateBps)}
                  </span>
                </div>

                <Input
                  name={CATEGORY_FORM_FIELD[category]}
                  label="قيمة المبيعات"
                  type="number"
                  min="0"
                  step="0.01"
                  inputMode="decimal"
                  dir="ltr"
                  placeholder="0.00"
                  value={amounts[category]}
                  onChange={(event) => handleAmountChange(category, event.target.value)}
                />

                <div className="flex items-center justify-between rounded-card bg-navy-deep px-3 py-2.5">
                  <span className="text-neutral-bg/60">النسبة المتوقعة</span>
                  <span className="text-lg font-semibold text-gold-dark" dir="ltr">
                    {formatCurrencyFromCents(previewCommissionCents)}
                  </span>
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" disabled={isPending}>
          {isPending ? "جارٍ الحفظ..." : "حفظ المبيعات"}
        </Button>
        <Button type="button" variant="outline" onClick={handleClearAmounts} disabled={isPending}>
          تصفير الحاسبة
        </Button>
        {state.error && (
          <span role="alert" className="text-sm text-rose-600">
            {state.error}
          </span>
        )}
        {state.success && (
          <span role="status" className="text-sm text-emerald-600">
            {state.success}
          </span>
        )}
      </div>
    </form>
  );
}
