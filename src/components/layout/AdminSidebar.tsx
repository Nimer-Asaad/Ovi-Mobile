"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import { ADMIN_NAV_ITEMS, ADMIN_ASSISTANT_NAV_ITEMS, ROLES } from "@/lib/constants";

export interface AdminSidebarProps {
  /** Picks which nav list renders — ADMIN_NAV_ITEMS (full) or
   * ADMIN_ASSISTANT_NAV_ITEMS (restricted). This is presentational only,
   * same as the route highlighting below; the real access boundary is each
   * section's server-side guard, not which links are shown here. */
  role: string;
}

/** Admin dashboard sidebar. Highlights the nav item matching the current
 * route — presentational only, route guarding happens in the layout. Dark
 * navy "chrome" — see tailwind.config.ts chrome.* tokens — kept separate
 * from the light navy.* tokens used by the admin content area. */
export function AdminSidebar({ role }: AdminSidebarProps) {
  const pathname = usePathname();
  const navItems = role === ROLES.ADMIN_ASSISTANT ? ADMIN_ASSISTANT_NAV_ITEMS : ADMIN_NAV_ITEMS;

  return (
    <aside className="hidden w-64 shrink-0 border-e border-chrome-border bg-chrome md:block md:sticky md:top-0 md:h-screen md:self-start md:overflow-y-auto print:hidden">
      <div className="flex h-16 items-center px-6">
        <span className="text-sm font-semibold tracking-wide text-gold-champagne">
          Ovi Mobile — الإدارة
        </span>
      </div>

      <nav className="flex flex-col gap-1 px-3 py-2 pb-6">
        {navItems.map((item) => {
          const isActive =
            item.href === "/admin"
              ? pathname === "/admin"
              : pathname === item.href || pathname.startsWith(`${item.href}/`);
          return (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                "rounded-card border-s-2 px-3 py-2 text-sm font-medium transition-all duration-150",
                isActive
                  ? "border-gold-champagne bg-gold-champagne/15 text-gold-light"
                  : "border-transparent text-white/70 hover:border-gold-champagne/40 hover:bg-chrome-surface hover:text-white",
              )}
            >
              {item.labelAr}
            </Link>
          );
        })}
      </nav>
    </aside>
  );
}
