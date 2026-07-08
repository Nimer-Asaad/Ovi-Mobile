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
