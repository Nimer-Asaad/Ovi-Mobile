import { requireRole } from "@/lib/auth/guards";
import { ROLES } from "@/lib/constants";

/** Kept at the outer /admin layout's ADMIN | ADMIN_ASSISTANT gate — this is
 * only the coarse entry check for the whole /admin/reps/** subtree, not the
 * real access boundary. ADMIN_ASSISTANT may only reach a narrow slice of
 * this subtree (the rep list, the assign-stock form, and the transfer-batch
 * invoice it redirects to on success) — every other page under here
 * (rep detail/management, return-stock, the legacy per-movement invoice)
 * re-narrows back down to requireRole([ROLES.ADMIN]) alone at its own page
 * level, since a nested layout here can't discriminate by sub-route the way
 * a per-page guard can. See each page.tsx under src/app/admin/reps/ for its
 * specific guard. Every rep-mutating server action in actions.ts carries its
 * own requireRole check too — page guards alone are never the sole line of
 * defense. */
export default async function AdminRepsLayout({ children }: { children: React.ReactNode }) {
  await requireRole([ROLES.ADMIN, ROLES.ADMIN_ASSISTANT]);
  return <>{children}</>;
}
