import { Spinner } from "@/components/ui/Spinner";

/** Shown inside the (already light, already-chrome-framed) admin shell
 * while an admin route's data is loading — the sidebar/topbar do not
 * re-render, only this area does. */
export default function AdminLoading() {
  return (
    <div className="flex min-h-[50vh] flex-col items-center justify-center gap-3">
      <Spinner className="h-8 w-8 text-gold-champagne" />
      <p className="text-sm text-neutral-bg/60">جاري التحميل...</p>
    </div>
  );
}
