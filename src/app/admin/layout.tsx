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

/** Admin dashboard shell. Only ADMIN sessions may render anything under
 * /admin — enforced here so every admin route inherits the guard. */
export default async function AdminLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  await requireRole([ROLES.ADMIN]);

  return (
    <div className="flex min-h-screen bg-navy-deep print:bg-white">
      <AdminSidebar />
      <div className="flex min-w-0 flex-1 flex-col">
        <AdminTopbar title="لوحة تحكم المدير" />
        <main className="flex-1 p-6 print:p-0">{children}</main>
      </div>
    </div>
  );
}
