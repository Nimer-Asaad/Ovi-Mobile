import { requireRole } from "@/lib/auth/guards";
import { ROLES } from "@/lib/constants";

export default async function RepLayout({ children }: { children: React.ReactNode }) {
  await requireRole([ROLES.SALES_REPRESENTATIVE]);

  return <div className="min-h-screen bg-navy-deep">{children}</div>;
}
