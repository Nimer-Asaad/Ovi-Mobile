"use client";

import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { formatCurrencyFromCents } from "@/lib/utils";

type CategoryKey = "wholesale" | "superWholesale" | "retail";

interface CommissionCategory {
  key: CategoryKey;
  label: string;
  rate: number;
  ratePercentLabel: string;
}

/** The three fixed online-sale commission tiers — rates are business
 * constants for this calculator only (unrelated to product wholesale/retail
 * pricing elsewhere in the app). */
const CATEGORIES: CommissionCategory[] = [
  { key: "wholesale", label: "الجملة", rate: 0.05, ratePercentLabel: "5%" },
  { key: "superWholesale", label: "جملة الجملة", rate: 0.035, ratePercentLabel: "3.5%" },
  { key: "retail", label: "المفرق", rate: 0.07, ratePercentLabel: "7%" },
];

type SalesInputs = Record<CategoryKey, string>;

const EMPTY_INPUTS: SalesInputs = { wholesale: "", superWholesale: "", retail: "" };

/** Strips any "-" the user types/pastes so the field can never hold a
 * negative amount — simpler and more transparent than silently computing
 * with zero while still showing a negative-looking value. */
function stripNegativeSign(raw: string): string {
  return raw.replace(/-/g, "");
}

/** Parses a raw sales-amount input into non-negative integer cents. Blank or
 * non-numeric text is treated as zero. Same `Math.round(Number(v) * 100)`
 * cents convention used by every money field elsewhere in this app (see
 * src/lib/validation/accounts.ts) — kept here rather than imported since
 * those are server-side zod transforms, not a shared client helper. */
function toSalesCents(rawValue: string): number {
  const parsed = Number(rawValue);
  if (!rawValue.trim() || !Number.isFinite(parsed) || parsed < 0) return 0;
  return Math.round(parsed * 100);
}

/** أون لاين — an independent commission calculator for the owner's online
 * sales. Entirely client-side arithmetic with no persistence: it never
 * reads or writes Orders/Payments/Accounts/Inventory/REP_CAR, so it cannot
 * affect any existing accounting calculation. Every amount is carried as
 * integer cents internally (only converted to a display string via
 * formatCurrencyFromCents) to avoid floating-point display artifacts like
 * 49.999999999. */
export function OnlineCommissionCalculator() {
  const [inputs, setInputs] = useState<SalesInputs>(EMPTY_INPUTS);

  const rows = CATEGORIES.map((category) => {
    const salesCents = toSalesCents(inputs[category.key]);
    const commissionCents = Math.round(salesCents * category.rate);
    return { ...category, salesCents, commissionCents };
  });

  const totalSalesCents = rows.reduce((sum, row) => sum + row.salesCents, 0);
  const totalCommissionCents = rows.reduce((sum, row) => sum + row.commissionCents, 0);

  function handleAmountChange(key: CategoryKey, rawValue: string) {
    setInputs((current) => ({ ...current, [key]: stripNegativeSign(rawValue) }));
  }

  function handleReset() {
    setInputs(EMPTY_INPUTS);
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        {rows.map((row) => (
          <Card key={row.key}>
            <CardHeader>
              <CardTitle>{row.label}</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-4">
              <div className="flex items-center justify-between">
                <span className="text-neutral-bg/60">نسبة العمولة</span>
                <span className="font-semibold text-neutral-bg" dir="ltr">
                  {row.ratePercentLabel}
                </span>
              </div>

              <Input
                label="قيمة المبيعات"
                type="number"
                min="0"
                step="0.01"
                inputMode="decimal"
                dir="ltr"
                placeholder="0.00"
                value={inputs[row.key]}
                onChange={(event) => handleAmountChange(row.key, event.target.value)}
              />

              <div className="flex items-center justify-between rounded-card bg-navy-deep px-3 py-2.5">
                <span className="text-neutral-bg/60">نسبتي</span>
                <span className="text-lg font-semibold text-gold-dark" dir="ltr">
                  {formatCurrencyFromCents(row.commissionCents)}
                </span>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      <Card className="border-gold-champagne/40 bg-gold-champagne/5">
        <CardHeader>
          <CardTitle>الملخص</CardTitle>
          <Button type="button" variant="outline" size="sm" onClick={handleReset}>
            تصفير الحاسبة
          </Button>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="flex items-center justify-between rounded-card border border-navy-soft bg-navy-surface p-4">
              <span className="text-sm text-neutral-bg/60">إجمالي المبيعات</span>
              <span className="text-xl font-bold text-neutral-bg" dir="ltr">
                {formatCurrencyFromCents(totalSalesCents)}
              </span>
            </div>
            <div className="flex items-center justify-between rounded-card border border-gold-champagne/50 bg-navy-surface p-4">
              <span className="text-sm text-neutral-bg/60">إجمالي نسبتي</span>
              <span className="text-xl font-bold text-gold-dark" dir="ltr">
                {formatCurrencyFromCents(totalCommissionCents)}
              </span>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
