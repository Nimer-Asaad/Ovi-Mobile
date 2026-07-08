import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

/** Merge Tailwind class names safely, resolving conflicting utility classes. */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}

/**
 * Format an Int amount stored in the smallest currency unit (e.g. agorot)
 * into a human-readable string. Locale defaults to Arabic (ar) to match the
 * app's RTL-first default.
 */
export function formatCurrencyFromCents(
  cents: number,
  currency: string = "ILS",
  locale: string = "ar",
): string {
  return new Intl.NumberFormat(locale, {
    style: "currency",
    currency,
    currencyDisplay: "symbol",
  }).format(cents / 100);
}

/** URL-safe slug, Unicode-letter aware (so Arabic-only names still produce a
 * usable slug instead of an empty string). */
export function slugify(input: string): string {
  return input
    .trim()
    .toLowerCase()
    .replace(/[\s_]+/g, "-")
    .replace(/[^\p{L}\p{N}-]+/gu, "")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}
