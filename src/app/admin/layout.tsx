import { AdminSidebar } from "@/components/layout/AdminSidebar";
import { AdminTopbar } from "@/components/layout/AdminTopbar";
import { requireRole } from "@/lib/auth/guards";
import { ROLES } from "@/lib/constants";

// Every /admin/** page queries the DB behind an auth guard — force dynamic
// at the layout so the whole subtree is never attempted for static
// generation. Relying on cookies()-triggered implicit dynamism wasn't
// enough: Next.js's build-time "Collecting page data" step still executed
// page-level Prisma calls (see DEPLOYMENT.md). This is a route segment
// config read statically from this file, not runtime API-call detection,
// so it skips that build-time render attempt entirely.
export const dynamic = "force-dynamic";

/** Admin dashboard shell. ADMIN and ADMIN_ASSISTANT sessions may render
 * anything under /admin at this outer-shell level — enforced here so every
 * admin route at least requires one of these two roles. This is only the
 * coarse gate, though: ADMIN_ASSISTANT (مساعد الأدمن, warehouse
 * picker/preparer staff) must NOT reach most admin sections. Each
 * ADMIN-only subsection has its own nested layout.tsx that narrows the
 * guard back down to requireRole([ROLES.ADMIN]) alone — see e.g.
 * src/app/admin/products/layout.tsx. Sections ADMIN_ASSISTANT legitimately
 * needs (orders, inventory) have no such nested layout, but still gate
 * ADMIN-only actions within themselves (e.g. /admin/orders/new,
 * ADJUSTMENT/STOCK_IN in the inventory server actions). */
export default async function AdminLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const user = await requireRole([ROLES.ADMIN, ROLES.ADMIN_ASSISTANT]);

  return (
    <div className="flex min-h-screen bg-navy-deep print:bg-white">
      <AdminSidebar role={user.role} />
      <div className="flex min-w-0 flex-1 flex-col">
        <AdminTopbar title={user.role === ROLES.ADMIN_ASSISTANT ? "لوحة مساعد الأدمن" : "لوحة تحكم المدير"} role={user.role} />
        <main className="flex-1 p-6 print:p-0">{children}</main>
      </div>
    </div>
  );
}
