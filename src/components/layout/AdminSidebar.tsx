"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import { ADMIN_NAV_ITEMS } from "@/lib/constants";

/** Admin dashboard sidebar. Highlights the nav item matching the current
 * route — presentational only, route guarding happens in the layout. */
export function AdminSidebar() {
  const pathname = usePathname();

  return (
    <aside className="hidden w-64 shrink-0 border-e border-navy-soft bg-navy-surface md:block">
      <div className="flex h-16 items-center px-6">
        <span className="text-sm font-semibold tracking-wide text-gold-dark">
          Ovi Mobile — الإدارة
        </span>
      </div>

      <nav className="flex flex-col gap-1 px-3 py-2">
        {ADMIN_NAV_ITEMS.map((item) => {
          const isActive =
            item.href === "/admin"
              ? pathname === "/admin"
              : pathname === item.href || pathname.startsWith(`${item.href}/`);
          return (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                "rounded-card px-3 py-2 text-sm font-medium transition-colors",
                isActive
                  ? "bg-gold-champagne/10 text-gold-dark"
                  : "text-neutral-bg/70 hover:bg-navy-soft/60 hover:text-neutral-bg",
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
