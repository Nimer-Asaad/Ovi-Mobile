import { Spinner } from "@/components/ui/Spinner";

/** Route-segment loading fallback for the entire /rep/** subtree — same
 * single-file-covers-every-child-route convention as src/app/admin/loading.tsx
 * (there is no page.tsx at this exact level besides RepDashboardPage; this
 * file, like admin's, is inherited by every nested route — /rep/sales,
 * /rep/sales/new, /rep/merchants, etc. — that doesn't define its own more
 * specific loading.tsx).
 *
 * Root cause this fixes: before this file existed, /rep/** had NO loading
 * boundary at all, so Next.js could not wrap navigation in a <Suspense>
 * fallback — clicking a sidebar link produced zero visual feedback until the
 * destination's full server-side data fetch resolved. Reps interpreted that
 * silence as "the click didn't register" and clicked again (and again),
 * which is what looked like a single/double-click bug even though every
 * sidebar link (RepSidebar/RepTopbar) was already a single, real <Link> the
 * whole time — see those components' own doc comments. Adding this restores
 * the same instant-feedback behavior /admin/** already has (compare
 * src/app/admin/loading.tsx), and lets Next.js prefetch up to this boundary
 * instead of nothing. The sidebar/topbar themselves live in rep/layout.tsx,
 * above this boundary, so they never remount or flicker while this shows. */
export default function RepLoading() {
  return (
    <div className="flex min-h-[50vh] flex-col items-center justify-center gap-3">
      <Spinner className="h-8 w-8 text-gold-champagne" />
      <p className="text-sm text-neutral-bg/60">جاري التحميل...</p>
    </div>
  );
}
