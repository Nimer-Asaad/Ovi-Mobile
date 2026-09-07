import { requireEffectiveRepresentative } from "@/lib/auth/impersonation";
import { RepSidebar } from "@/components/layout/RepSidebar";
import { RepTopbar } from "@/components/layout/RepTopbar";
import { ImpersonationBanner } from "@/components/rep/ImpersonationBanner";

// Every /rep/** page queries the DB behind an auth guard — force dynamic
// at the layout so the whole subtree is never attempted for static
// generation at build time (see admin/layout.tsx for the full rationale).
export const dynamic = "force-dynamic";

/** Rep dashboard shell — same sidebar+topbar chrome as /admin (AdminLayout),
 * so every /rep/** page inherits consistent navigation instead of the
 * previous ad-hoc per-page header/button-row pattern.
 *
 * The ONE central gate for the entire /rep/** subtree: resolves the
 * effective REP scope via requireEffectiveRepresentative — a real
 * SALES_REPRESENTATIVE acting on their own profile, or a real ADMIN with
 * an active, DB-revalidated impersonation context. Neither this layout nor
 * any individual /rep page re-derives that scope independently anymore;
 * every page/action reads it from the same helper. Renders the
 * impersonation banner here, once, so it's guaranteed visible on every
 * single /rep page without each one remembering to include it — never
 * invisible impersonation. */
export default async function RepLayout({ children }: { children: React.ReactNode }) {
  const effectiveRep = await requireEffectiveRepresentative();

  return (
    <div className="flex min-h-screen flex-col bg-navy-deep print:bg-white">
      {effectiveRep.isImpersonating && <ImpersonationBanner repName={effectiveRep.repName} />}
      <div className="flex min-h-0 flex-1">
        <RepSidebar />
        <div className="flex min-w-0 flex-1 flex-col">
          <RepTopbar title="لوحة تحكم المندوب" />
          <main className="flex-1 p-6 print:p-0">{children}</main>
        </div>
      </div>
    </div>
  );
}
