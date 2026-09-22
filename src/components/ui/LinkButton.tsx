import type { AnchorHTMLAttributes, ReactNode } from "react";
import Link, { type LinkProps } from "next/link";
import { cn } from "@/lib/utils";
import { BUTTON_VARIANT_STYLES, BUTTON_SIZE_STYLES, type ButtonVariant, type ButtonSize } from "./Button";

export interface LinkButtonProps extends LinkProps, Omit<AnchorHTMLAttributes<HTMLAnchorElement>, keyof LinkProps | "href"> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  className?: string;
  children: ReactNode;
}

/** A navigation control styled exactly like Button, rendered as ONE real
 * `<a>` (via next/link) instead of `<Link><Button>...</Button></Link>`.
 *
 * WHY THIS EXISTS: nesting a `<button>` inside an `<a>` is invalid HTML
 * (interactive content may not contain other interactive content) — browsers
 * silently "repair" the tree, and on touch devices the practical symptom is
 * that the FIRST tap only reaches the inner `<button>` (which has no handler
 * of its own here) and the `<a>`'s navigation only fires on a SECOND tap.
 * Button's own `active:scale-[0.98]` transform makes this worse: WebKit ties
 * that transform's transition to the tap that "activates" the inner element,
 * consuming it instead of the anchor's click. Rendering the Button's classes
 * directly on the `<a>` — no nested interactive element — fixes both at once
 * and restores plain one-tap/one-click navigation, with no visual change. */
export function LinkButton({ variant = "primary", size = "md", className, children, ...props }: LinkButtonProps) {
  return (
    <Link
      className={cn(
        "inline-flex items-center justify-center gap-2 rounded-card font-medium transition-all duration-150 active:scale-[0.98]",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-offset-navy-deep",
        "aria-disabled:pointer-events-none aria-disabled:opacity-50",
        BUTTON_VARIANT_STYLES[variant],
        BUTTON_SIZE_STYLES[size],
        className,
      )}
      {...props}
    >
      {children}
    </Link>
  );
}
