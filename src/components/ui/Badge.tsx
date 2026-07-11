import type { HTMLAttributes, ReactNode } from "react";
import { cn } from "@/lib/utils";

export type BadgeVariant = "gold" | "neutral" | "success" | "warning" | "danger";

export interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
  variant?: BadgeVariant;
  children: ReactNode;
}

const VARIANT_STYLES: Record<BadgeVariant, string> = {
  gold: "bg-gold-champagne/10 text-gold-dark border-gold-champagne/30",
  neutral: "bg-navy-soft/60 text-neutral-bg/70 border-navy-soft",
  success: "bg-emerald-500/10 text-emerald-700 border-emerald-500/25",
  warning: "bg-amber-500/10 text-amber-700 border-amber-500/25",
  danger: "bg-rose-500/10 text-rose-700 border-rose-500/25",
};

export function Badge({ variant = "neutral", className, children, ...props }: BadgeProps) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-xs font-medium",
        VARIANT_STYLES[variant],
        className,
      )}
      {...props}
    >
      {children}
    </span>
  );
}
