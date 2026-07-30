"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import { REP_NAV_ITEMS } from "@/lib/constants";

/** Rep dashboard sidebar — same structure/tokens as AdminSidebar, sourced
 * from REP_NAV_ITEMS instead of ADMIN_NAV_ITEMS. Presentational only, route
 * guarding happens in the layout. */
export function RepSidebar() {
  const pathname = usePathname();

  return (
    <aside className="hidden w-64 shrink-0 border-e border-chrome-border bg-chrome md:block md:sticky md:top-0 md:h-screen md:self-start md:overflow-y-auto print:hidden">
      <div className="flex h-16 items-center px-6">
        <span className="text-sm font-semibold tracking-wide text-gold-champagne">
          Ovi Mobile — المندوب
        </span>
      </div>

      <nav className="flex flex-col gap-1 px-3 py-2 pb-6">
        {REP_NAV_ITEMS.map((item) => {
          const isActive =
            item.href === "/rep"
              ? pathname === "/rep"
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
