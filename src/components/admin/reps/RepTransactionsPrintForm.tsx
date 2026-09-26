"use client";

import { useState } from "react";
import { Button } from "@/components/ui/Button";

/** Small date-range form for the combined rep invoices/receipts print page.
 * Plain GET navigation — validation happens server-side. */
export function RepTransactionsPrintForm({ repId, defaultDate }: { repId: string; defaultDate: string }) {
  const [open, setOpen] = useState(false);

  if (!open) {
    return (
      <Button type="button" variant="outline" onClick={() => setOpen(true)}>
        طباعة فواتير ودفعات المندوب
      </Button>
    );
  }

  return (
    <form method="get" action={`/admin/reps/${repId}/print-transactions`} target="_blank" className="flex flex-wrap items-end gap-2 rounded-card border border-navy-soft p-2">
      <label className="flex flex-col gap-1 text-xs text-neutral-bg/70">
        من تاريخ
        <input type="date" name="from" defaultValue={defaultDate} required className="h-9 rounded-card border border-navy-soft bg-navy-deep px-2 text-sm text-neutral-bg" />
      </label>
      <label className="flex flex-col gap-1 text-xs text-neutral-bg/70">
        من وقت
        <input type="time" name="fromTime" defaultValue="00:00" className="h-9 rounded-card border border-navy-soft bg-navy-deep px-2 text-sm text-neutral-bg" />
      </label>
      <label className="flex flex-col gap-1 text-xs text-neutral-bg/70">
        إلى تاريخ
        <input type="date" name="to" defaultValue={defaultDate} required className="h-9 rounded-card border border-navy-soft bg-navy-deep px-2 text-sm text-neutral-bg" />
      </label>
      <label className="flex flex-col gap-1 text-xs text-neutral-bg/70">
        إلى وقت
        <input type="time" name="toTime" defaultValue="23:59" className="h-9 rounded-card border border-navy-soft bg-navy-deep px-2 text-sm text-neutral-bg" />
      </label>
      <Button type="submit">عرض / طباعة</Button>
      <Button type="button" variant="outline" onClick={() => setOpen(false)}>
        إلغاء
      </Button>
    </form>
  );
}
