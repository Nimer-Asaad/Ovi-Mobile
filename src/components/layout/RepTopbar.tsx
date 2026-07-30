import Link from "next/link";
import { Badge } from "@/components/ui/Badge";
import { LogoutButton } from "@/components/auth/LogoutButton";
import { REP_NAV_ITEMS } from "@/lib/constants";

export interface RepTopbarProps {
  title: string;
}

/** Rep dashboard topbar — same structure/tokens as AdminTopbar. Below `md`
 * — where `RepSidebar` is hidden — this also renders a horizontally
 * scrollable pill nav so rep sections stay reachable on small screens. */
export function RepTopbar({ title }: RepTopbarProps) {
  return (
    <header className="sticky top-0 z-30 border-b border-chrome-border bg-chrome shadow-sm print:hidden">
      <div className="flex h-16 items-center justify-between px-6">
        <h1 className="text-lg font-semibold text-white">{title}</h1>

        <div className="flex items-center gap-3">
          <Badge variant="gold" className="border-gold-champagne/40 bg-gold-champagne/15 text-gold-light">
            مندوب مبيعات
          </Badge>
          <LogoutButton className="border-gold-champagne/40 text-gold-light hover:bg-chrome-surface" />
        </div>
      </div>

      <nav
        aria-label="التنقل في لوحة تحكم المندوب"
        className="flex gap-2 overflow-x-auto border-t border-chrome-border px-3 py-2 md:hidden"
      >
        {REP_NAV_ITEMS.map((item) => (
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
