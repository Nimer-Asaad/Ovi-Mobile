import { AdminSidebar } from "@/components/layout/AdminSidebar";
import { AdminTopbar } from "@/components/layout/AdminTopbar";
import { requireRole } from "@/lib/auth/guards";
import { ROLES } from "@/lib/constants";

/** Admin dashboard shell. Only ADMIN sessions may render anything under
 * /admin — enforced here so every admin route inherits the guard. */
export default async function AdminLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  await requireRole([ROLES.ADMIN]);

  return (
    <div className="flex min-h-screen bg-navy-deep">
      <AdminSidebar />
      <div className="flex min-w-0 flex-1 flex-col">
        <AdminTopbar title="لوحة تحكم المدير" />
        <main className="flex-1 p-6">{children}</main>
      </div>
    </div>
  );
}
