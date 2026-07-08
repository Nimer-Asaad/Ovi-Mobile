import { AdminSidebar } from "@/components/layout/AdminSidebar";
import { AdminTopbar } from "@/components/layout/AdminTopbar";

/**
 * Admin dashboard shell skeleton. No route protection yet — role-based
 * access control lands in Phase 2 (Auth & RBAC).
 */
export default function AdminLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <div className="flex min-h-screen bg-navy-deep">
      <AdminSidebar />
      <div className="flex flex-1 flex-col">
        <AdminTopbar title="لوحة تحكم المدير" />
        <main className="flex-1 p-6">{children}</main>
      </div>
    </div>
  );
}
