import { requireRole } from "@/lib/auth/guards";
import { ROLES } from "@/lib/constants";

/** Narrows the outer /admin layout's ADMIN | ADMIN_ASSISTANT gate back down
 * to ADMIN alone — color management is not part of ADMIN_ASSISTANT's
 * warehouse-picker permission set. */
export default async function AdminColorsLayout({ children }: { children: React.ReactNode }) {
  await requireRole([ROLES.ADMIN]);
  return <>{children}</>;
}
