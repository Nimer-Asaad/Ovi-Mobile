import type { ElementType, ReactNode } from "react";
import { cn } from "@/lib/utils";

export interface PageHeaderProps {
  title: string;
  subtitle?: string;
  actions?: ReactNode;
  /** Heading level for the title — "h2" (default) for admin/section pages,
   * "h1" for standalone top-level pages that don't otherwise render one. */
  as?: ElementType;
  className?: string;
}

export function PageHeader({ title, subtitle, actions, as: Title = "h2", className }: PageHeaderProps) {
  return (
    <div className={cn("flex flex-wrap items-center justify-between gap-3", className)}>
      <div>
        <Title className="text-xl font-semibold text-neutral-bg">{title}</Title>
        {subtitle && <p className="mt-1 text-sm text-neutral-bg/60">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-3">{actions}</div>}
    </div>
  );
}
