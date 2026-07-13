"use client";

import { useActionState, useState } from "react";
import {
  rejectStockRequest,
  markStockRequestPrepared,
  completeStockRequest,
  type RepStockRequestActionState,
} from "@/app/admin/rep-requests/[requestId]/actions";
import { Textarea } from "@/components/ui/Textarea";
import { Button } from "@/components/ui/Button";
import { Spinner } from "@/components/ui/Spinner";
import { STOCK_REQUEST_STATUSES } from "@/lib/constants";

const initialState: RepStockRequestActionState = {};

/** The reject/prepare/complete transitions — each a tiny standalone form so
 * a failed one (e.g. "warehouse stock insufficient" on complete) doesn't
 * disturb the review form's own state. Only the buttons matching the
 * request's current status are rendered. */
export function RepStockRequestActionButtons({ requestId, status }: { requestId: string; status: string }) {
  if (status === STOCK_REQUEST_STATUSES.PENDING || status === STOCK_REQUEST_STATUSES.REVIEWED) {
    return (
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <RejectForm requestId={requestId} />
        {status === STOCK_REQUEST_STATUSES.REVIEWED && <PrepareForm requestId={requestId} />}
      </div>
    );
  }
  if (status === STOCK_REQUEST_STATUSES.PREPARED) {
    return <CompleteForm requestId={requestId} />;
  }
  return null;
}

function RejectForm({ requestId }: { requestId: string }) {
  const action = rejectStockRequest.bind(null, requestId);
  const [state, formAction, isPending] = useActionState(action, initialState);
  const [reason, setReason] = useState("");

  return (
    <form action={formAction} className="flex flex-1 flex-col gap-2">
      <Textarea
        name="adminNote"
        label="سبب الرفض (اختياري)"
        value={reason}
        onChange={(event) => setReason(event.target.value)}
        rows={2}
      />
      {state.error && (
        <p className="text-sm text-rose-600" role="alert">
          {state.error}
        </p>
      )}
      <Button type="submit" variant="outline" disabled={isPending}>
        {isPending && <Spinner />}
        {isPending ? "جارٍ الرفض..." : "رفض الطلب"}
      </Button>
    </form>
  );
}

function PrepareForm({ requestId }: { requestId: string }) {
  const action = markStockRequestPrepared.bind(null, requestId);
  const [state, formAction, isPending] = useActionState(action, initialState);

  return (
    <form action={formAction} className="flex flex-col gap-2">
      {state.error && (
        <p className="text-sm text-rose-600" role="alert">
          {state.error}
        </p>
      )}
      <Button type="submit" disabled={isPending}>
        {isPending && <Spinner />}
        {isPending ? "جارٍ التجهيز..." : "تحديد كجاهز للتسليم"}
      </Button>
    </form>
  );
}

function CompleteForm({ requestId }: { requestId: string }) {
  const action = completeStockRequest.bind(null, requestId);
  const [state, formAction, isPending] = useActionState(action, initialState);

  return (
    <form action={formAction} className="flex flex-col gap-2">
      {state.error && (
        <p className="text-sm text-rose-600" role="alert">
          {state.error}
        </p>
      )}
      <Button type="submit" disabled={isPending}>
        {isPending && <Spinner />}
        {isPending ? "جارٍ الاستلام..." : "تأكيد الاستلام وتحويل المخزون"}
      </Button>
    </form>
  );
}
