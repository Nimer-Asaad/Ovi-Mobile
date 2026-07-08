import Link from "next/link";
import { ADMIN_NAV_ITEMS } from "@/lib/constants";

/** Admin dashboard sidebar skeleton. Renders the centralized nav list;
 * active-link styling and route guarding land in Phase 2. */
export function AdminSidebar() {
  return (
    <aside className="hidden w-64 shrink-0 border-e border-navy-soft bg-navy-surface md:block">
      <div className="flex h-16 items-center px-6">
        <span className="text-sm font-semibold tracking-wide text-gold-champagne">
          Ovi Mobile — الإدارة
        </span>
      </div>

      <nav className="flex flex-col gap-1 px-3 py-2">
        {ADMIN_NAV_ITEMS.map((item) => (
          <Link
            key={item.href}
            href={item.href}
            className="rounded-card px-3 py-2 text-sm text-neutral-bg/80 transition-colors hover:bg-navy-soft hover:text-neutral-bg"
          >
            {item.labelAr}
          </Link>
        ))}
      </nav>
    </aside>
  );
}
