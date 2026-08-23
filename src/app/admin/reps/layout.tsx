import { requireRole } from "@/lib/auth/guards";
import { ROLES } from "@/lib/constants";

/** Narrows the outer /admin layout's ADMIN | ADMIN_ASSISTANT gate back down
 * to ADMIN alone — sales-rep management, loading/returning rep car stock,
 * and rep customer orders are not part of ADMIN_ASSISTANT's warehouse-
 * picker permission set. */
export default async function AdminRepsLayout({ children }: { children: React.ReactNode }) {
  await requireRole([ROLES.ADMIN]);
  return <>{children}</>;
}
