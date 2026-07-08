import type { TextareaHTMLAttributes } from "react";
import { cn } from "@/lib/utils";

export interface TextareaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  label?: string;
  error?: string;
}

export function Textarea({ label, error, className, id, name, ...props }: TextareaProps) {
  const textareaId = id ?? name;

  return (
    <div className="flex flex-col gap-1.5">
      {label && (
        <label htmlFor={textareaId} className="text-sm font-medium text-neutral-bg/80">
          {label}
        </label>
      )}
      <textarea
        id={textareaId}
        name={name}
        rows={4}
        className={cn(
          "rounded-card border border-navy-soft bg-navy-deep px-3 py-2 text-sm text-neutral-bg placeholder:text-neutral-bg/40",
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
