"use client";

import { useActionState } from "react";
import { updateMerchantAssignment, type MerchantAssignmentState } from "./actions";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Select } from "@/components/ui/Select";
import { Spinner } from "@/components/ui/Spinner";

const initialState: MerchantAssignmentState = {};

interface MerchantAssignmentFormProps {
  merchantId: string;
  currentRegion: string | null;
  currentAssignedRepId: string | null;
  reps: { id: string; label: string }[];
}

export function MerchantAssignmentForm({
  merchantId,
  currentRegion,
  currentAssignedRepId,
  reps,
}: MerchantAssignmentFormProps) {
  const action = updateMerchantAssignment.bind(null, merchantId);
  const [state, formAction, isPending] = useActionState(action, initialState);

  return (
    <form action={formAction} className="flex flex-col gap-4 sm:flex-row sm:items-end">
      <div className="flex-1">
        <Input name="region" label="المنطقة" defaultValue={currentRegion ?? ""} placeholder="مثال: نابلس" />
      </div>
      <div className="flex-1">
        <Select name="assignedRepId" label="المندوب المسؤول" defaultValue={currentAssignedRepId ?? ""}>
          <option value="">بدون مندوب</option>
          {reps.map((rep) => (
            <option key={rep.id} value={rep.id}>
              {rep.label}
            </option>
          ))}
        </Select>
      </div>
      <div className="flex flex-col gap-1">
        <Button type="submit" disabled={isPending}>
          {isPending && <Spinner />}
          {isPending ? "جارٍ الحفظ..." : "حفظ"}
        </Button>
        {state.error && (
          <p className="text-xs text-rose-600" role="alert">
            {state.error}
          </p>
        )}
        {state.success && <p className="text-xs text-emerald-600">{state.success}</p>}
      </div>
    </form>
  );
}
