import { requireRole } from "@/lib/auth/guards";
import { ROLES } from "@/lib/constants";

// Every /rep/** page queries the DB behind an auth guard — force dynamic
// at the layout so the whole subtree is never attempted for static
// generation at build time (see admin/layout.tsx for the full rationale).
export const dynamic = "force-dynamic";

export default async function RepLayout({ children }: { children: React.ReactNode }) {
  await requireRole([ROLES.SALES_REPRESENTATIVE]);

  return <div className="min-h-screen bg-navy-deep">{children}</div>;
}
