import { requireRole } from "@/lib/auth/guards";
import { ROLES } from "@/lib/constants";
import { RepSidebar } from "@/components/layout/RepSidebar";
import { RepTopbar } from "@/components/layout/RepTopbar";

// Every /rep/** page queries the DB behind an auth guard — force dynamic
// at the layout so the whole subtree is never attempted for static
// generation at build time (see admin/layout.tsx for the full rationale).
export const dynamic = "force-dynamic";

/** Rep dashboard shell — same sidebar+topbar chrome as /admin (AdminLayout),
 * so every /rep/** page inherits consistent navigation instead of the
 * previous ad-hoc per-page header/button-row pattern. */
export default async function RepLayout({ children }: { children: React.ReactNode }) {
  await requireRole([ROLES.SALES_REPRESENTATIVE]);

  return (
    <div className="flex min-h-screen bg-navy-deep">
      <RepSidebar />
      <div className="flex min-w-0 flex-1 flex-col">
        <RepTopbar title="لوحة تحكم المندوب" />
        <main className="flex-1 p-6">{children}</main>
      </div>
    </div>
  );
}
