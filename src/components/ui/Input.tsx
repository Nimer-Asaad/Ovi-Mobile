import type { InputHTMLAttributes } from "react";
import { cn } from "@/lib/utils";

export interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  error?: string;
}

export function Input({ label, error, className, id, name, ...props }: InputProps) {
  const inputId = id ?? name;

  return (
    <div className="flex flex-col gap-1.5">
      {label && (
        <label htmlFor={inputId} className="text-sm font-medium text-neutral-bg/80">
          {label}
        </label>
      )}
      <input
        id={inputId}
        name={name}
        className={cn(
          "h-10 rounded-card border border-navy-soft bg-navy-deep px-3 text-sm text-neutral-bg placeholder:text-neutral-bg/40",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold-champagne focus-visible:ring-offset-2 focus-visible:ring-offset-navy-surface",
          error && "border-rose-500",
          className,
        )}
        {...props}
      />
      {error && <span className="text-xs text-rose-400">{error}</span>}
    </div>
  );
}
