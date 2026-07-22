import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export interface StorefrontSectionProps {
  title?: string;
  subtitle?: string;
  action?: ReactNode;
  /** Applied to the full-width outer `<section>` — e.g. a band background
   * or border — kept separate from the centered content container so it
   * spans the full viewport width, not just the max-w-6xl content area. */
  className?: string;
  children: ReactNode;
}

/** Consistent fade-in wrapper for homepage sections — title/subtitle on the
 * start side, an optional action (e.g. "عرض الكل") on the end side. */
export function StorefrontSection({ title, subtitle, action, className, children }: StorefrontSectionProps) {
  return (
    <section className={cn("animate-fade-in", className)}>
      <div className="mx-auto max-w-6xl px-4 py-14 sm:px-6 md:py-20 lg:px-4 lg:py-24">
        {(title || action) && (
          <div className="mb-9 flex flex-wrap items-end justify-between gap-4 md:mb-11">
            <div className="max-w-2xl">
              {title && <h2 className="text-2xl font-bold tracking-tight text-neutral-bg sm:text-3xl">{title}</h2>}
              {subtitle && <p className="mt-2 text-sm leading-6 text-neutral-bg/60 sm:text-base">{subtitle}</p>}
            </div>
            {action}
          </div>
        )}
        {children}
      </div>
    </section>
  );
}
