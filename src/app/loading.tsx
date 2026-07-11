import { Spinner } from "@/components/ui/Spinner";

/** App Router route-segment loading fallback — shown automatically while a
 * page (or its data) is still loading server-side. */
export default function Loading() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-3 bg-navy-deep px-4">
      <Spinner className="h-8 w-8 text-gold-champagne" />
      <p className="text-sm text-neutral-bg/60">جاري التحميل...</p>
    </div>
  );
}
