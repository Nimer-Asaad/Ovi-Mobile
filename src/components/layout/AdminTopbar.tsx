import Link from "next/link";
import { Badge } from "@/components/ui/Badge";
import { LogoutButton } from "@/components/auth/LogoutButton";
import { ADMIN_NAV_ITEMS } from "@/lib/constants";

export interface AdminTopbarProps {
  title: string;
}

/** Admin dashboard topbar. Below `md` — where `AdminSidebar` is hidden —
 * this also renders a horizontally scrollable pill nav so admin sections
 * stay reachable on small screens. Dark navy "chrome" — see
 * tailwind.config.ts chrome.* tokens — kept separate from the light navy.*
 * tokens used by the admin content area. Notifications land in a later
 * phase. */
export function AdminTopbar({ title }: AdminTopbarProps) {
  return (
    <header className="sticky top-0 z-30 border-b border-chrome-border bg-chrome shadow-sm">
      <div className="flex h-16 items-center justify-between px-6">
        <h1 className="text-lg font-semibold text-white">{title}</h1>

        <div className="flex items-center gap-3">
          <Badge variant="gold" className="border-gold-champagne/40 bg-gold-champagne/15 text-gold-light">
            مدير النظام
          </Badge>
          <LogoutButton className="border-gold-champagne/40 text-gold-light hover:bg-chrome-surface" />
        </div>
      </div>

      <nav
        aria-label="التنقل في لوحة التحكم"
        className="flex gap-2 overflow-x-auto border-t border-chrome-border px-3 py-2 md:hidden"
      >
        {ADMIN_NAV_ITEMS.map((item) => (
          <Link
            key={item.href}
            href={item.href}
            className="shrink-0 whitespace-nowrap rounded-full border border-chrome-border px-3 py-1.5 text-xs font-medium text-white/70 transition-colors hover:border-gold-champagne/50 hover:bg-chrome-surface hover:text-gold-light"
          >
            {item.labelAr}
          </Link>
        ))}
      </nav>
    </header>
  );
}
