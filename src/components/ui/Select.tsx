import type { SelectHTMLAttributes } from "react";
import { cn } from "@/lib/utils";

export interface SelectProps extends SelectHTMLAttributes<HTMLSelectElement> {
  label?: string;
  error?: string;
}

export function Select({ label, error, className, id, name, children, ...props }: SelectProps) {
  const selectId = id ?? name;

  return (
    <div className="flex flex-col gap-1.5">
      {label && (
        <label htmlFor={selectId} className="text-sm font-medium text-neutral-bg/80">
          {label}
        </label>
      )}
      <select
        id={selectId}
        name={name}
        className={cn(
          "h-10 rounded-card border border-navy-soft bg-navy-deep px-3 text-sm text-neutral-bg",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold-champagne focus-visible:ring-offset-2 focus-visible:ring-offset-navy-surface",
          error && "border-rose-500",
          className,
        )}
        {...props}
      >
        {children}
      </select>
      {error && <span className="text-xs text-rose-400">{error}</span>}
    </div>
  );
}
