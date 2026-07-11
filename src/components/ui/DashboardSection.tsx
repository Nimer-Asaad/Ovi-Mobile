import type { ReactNode } from "react";

export interface DashboardSectionProps {
  title: string;
  subtitle?: string;
  children: ReactNode;
}

/** Groups a set of dashboard stat cards under a titled, bordered section —
 * used to visually separate catalog/inventory/orders/merchants/reps
 * overviews on the admin dashboard. Uses the page background (not the white
 * card surface) so the white StatCards inside it stay visually distinct
 * instead of blending into an equally-white container. Presentational only. */
export function DashboardSection({ title, subtitle, children }: DashboardSectionProps) {
  return (
    <section className="animate-fade-in rounded-card border border-navy-soft bg-navy-deep p-6">
      <div className="mb-5">
        <h2 className="text-lg font-semibold text-neutral-bg">{title}</h2>
        {subtitle && <p className="mt-1 text-sm text-neutral-bg/60">{subtitle}</p>}
      </div>
      {children}
    </section>
  );
}
