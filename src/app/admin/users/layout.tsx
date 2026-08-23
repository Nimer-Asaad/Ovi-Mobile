import { requireRole } from "@/lib/auth/guards";
import { ROLES } from "@/lib/constants";

/** Narrows the outer /admin layout's ADMIN | ADMIN_ASSISTANT gate back down
 * to ADMIN alone — user/role management (including granting the
 * ADMIN_ASSISTANT role itself) must never be reachable by an
 * ADMIN_ASSISTANT session, so it can never promote itself or anyone else. */
export default async function AdminUsersLayout({ children }: { children: React.ReactNode }) {
  await requireRole([ROLES.ADMIN]);
  return <>{children}</>;
}
