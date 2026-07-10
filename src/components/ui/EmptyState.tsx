import type { ElementType, ReactNode } from "react";

export interface EmptyStateProps {
  title: string;
  message?: string;
  action?: ReactNode;
  icon?: ReactNode;
  /** Heading level for the title — "h3" (default) for empty states nested
   * inside an existing page heading, "h1" for standalone empty pages. */
  as?: ElementType;
}

export function EmptyState({ title, message, action, icon, as: Title = "h3" }: EmptyStateProps) {
  return (
    <div className="flex flex-col items-center gap-4 rounded-card border border-navy-soft bg-navy-surface px-4 py-16 text-center">
      {icon}
      <div>
        <Title className="text-lg font-semibold text-neutral-bg">{title}</Title>
        {message && <p className="mt-2 text-sm text-neutral-bg/60">{message}</p>}
      </div>
      {action}
    </div>
  );
}
