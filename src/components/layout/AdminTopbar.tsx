import Link from "next/link";
import { Badge } from "@/components/ui/Badge";
import { LogoutButton } from "@/components/auth/LogoutButton";
import { ADMIN_NAV_ITEMS } from "@/lib/constants";

export interface AdminTopbarProps {
  title: string;
}

/** Admin dashboard topbar. Below `md` — where `AdminSidebar` is hidden —
 * this also renders a horizontally scrollable pill nav so admin sections
 * stay reachable on small screens. Notifications land in a later phase. */
export function AdminTopbar({ title }: AdminTopbarProps) {
  return (
    <header className="border-b border-navy-soft bg-navy-surface shadow-sm">
      <div className="flex h-16 items-center justify-between px-6">
        <h1 className="text-lg font-semibold text-neutral-bg">{title}</h1>

        <div className="flex items-center gap-3">
          <Badge variant="gold">مدير النظام</Badge>
          <LogoutButton />
        </div>
      </div>

      <nav
        aria-label="التنقل في لوحة التحكم"
        className="flex gap-2 overflow-x-auto border-t border-navy-soft/60 px-3 py-2 md:hidden"
      >
        {ADMIN_NAV_ITEMS.map((item) => (
          <Link
            key={item.href}
            href={item.href}
            className="shrink-0 whitespace-nowrap rounded-full border border-navy-soft px-3 py-1.5 text-xs font-medium text-neutral-bg/70 transition-colors hover:border-gold-champagne/40 hover:text-gold-dark"
          >
            {item.labelAr}
          </Link>
        ))}
      </nav>
    </header>
  );
}
