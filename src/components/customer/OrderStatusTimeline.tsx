import { ORDER_STATUSES } from "@/lib/constants";
import { getOrderStatusLabel } from "@/lib/order-labels";
import { cn } from "@/lib/utils";

export interface OrderStatusTimelineProps {
  status: string;
}

/** The only "happy path" progression the app actually models — there is no
 * status-history table, so this timeline is derived purely from the
 * order's *current* status, never from invented historical timestamps. */
const HAPPY_PATH = [
  { status: ORDER_STATUSES.PENDING, label: "الطلب مستلم" },
  { status: ORDER_STATUSES.CONFIRMED, label: "تم تأكيد الطلب" },
  { status: ORDER_STATUSES.PREPARING, label: "قيد التجهيز" },
  { status: ORDER_STATUSES.OUT_FOR_DELIVERY, label: "قيد التوصيل" },
  { status: ORDER_STATUSES.DELIVERED, label: "تم التوصيل" },
] as const;

/** Order status visualized as a vertical progress timeline. Cancelled/
 * returned orders never fit the linear happy path — since we don't know how
 * far the order actually got before that happened, they render as a
 * distinct terminal state block instead of a fabricated progress bar. */
export function OrderStatusTimeline({ status }: OrderStatusTimelineProps) {
  if (status === ORDER_STATUSES.CANCELLED || status === ORDER_STATUSES.RETURNED) {
    return (
      <div className="flex items-center gap-3 rounded-card border border-rose-500/25 bg-rose-500/10 px-4 py-4">
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.75"
          strokeLinecap="round"
          strokeLinejoin="round"
          className="h-6 w-6 shrink-0 text-rose-600"
        >
          <circle cx="12" cy="12" r="9" />
          <path d="m9.5 9.5 5 5m0-5-5 5" />
        </svg>
        <div>
          <p className="text-sm font-medium text-rose-700">{getOrderStatusLabel(status)}</p>
          <p className="mt-0.5 text-xs text-rose-600/70">
            {status === ORDER_STATUSES.CANCELLED ? "تم إلغاء هذا الطلب." : "تم إرجاع هذا الطلب."}
          </p>
        </div>
      </div>
    );
  }

  const currentIndex = Math.max(
    0,
    HAPPY_PATH.findIndex((step) => step.status === status),
  );

  return (
    <ol className="flex flex-col">
      {HAPPY_PATH.map((step, index) => {
        const isReached = index <= currentIndex;
        const isCurrent = index === currentIndex;
        const isLast = index === HAPPY_PATH.length - 1;

        return (
          <li key={step.status} className="flex gap-3">
            <div className="flex flex-col items-center">
              <span
                className={cn(
                  "flex h-6 w-6 shrink-0 items-center justify-center rounded-full border-2",
                  isReached ? "border-gold-champagne bg-gold-champagne text-white" : "border-navy-soft bg-navy-surface",
                )}
              >
                {isReached ? (
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="h-3.5 w-3.5">
                    <path d="m5 13 4 4L19 7" />
                  </svg>
                ) : (
                  <span className="h-1.5 w-1.5 rounded-full bg-neutral-bg/30" />
                )}
              </span>
              {!isLast && (
                <span className={cn("min-h-[1.5rem] w-0.5 flex-1", index < currentIndex ? "bg-gold-champagne" : "bg-navy-soft")} />
              )}
            </div>
            <div className={cn("pb-6", isLast && "pb-0")}>
              <p className={cn("text-sm font-medium", isReached ? "text-neutral-bg" : "text-neutral-bg/40")}>{step.label}</p>
              {isCurrent && <p className="text-xs text-gold-dark">الحالة الحالية</p>}
            </div>
          </li>
        );
      })}
    </ol>
  );
}
