import { requireRole } from "@/lib/auth/guards";
import { ROLES } from "@/lib/constants";

// Every /merchant/** page queries the DB behind an auth guard — force
// dynamic at the layout so the whole subtree is never attempted for
// static generation at build time (see admin/layout.tsx for the full
// rationale).
export const dynamic = "force-dynamic";

/**
 * Only checks role here, deliberately NOT approval status — /merchant/pending
 * lives under this same layout and must stay reachable by PENDING/REJECTED
 * merchants. The approved-only gate is enforced one level down, in
 * /merchant/page.tsx itself.
 */
export default async function MerchantLayout({ children }: { children: React.ReactNode }) {
  await requireRole([ROLES.WHOLESALE_MERCHANT]);

  return <div className="min-h-screen bg-navy-deep">{children}</div>;
}
