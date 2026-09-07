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

/**
 * Format a Date carrying a TRUE, unambiguous UTC instant (e.g. a Postgres
 * `timestamptz` value) into Palestine business local date/time — the report
 * area's shared formatter, reused by REP and ADMIN instead of duplicating
 * this per component.
 *
 * Do NOT feed this a naive `createdAt` column value read directly off an
 * Order/AccountPayment — Prisma materializes that `timestamp without time
 * zone` column by taking its raw stored digits (the DB session's own wall
 * clock, production-verified as Europe/Berlin, not UTC) and tagging them as
 * UTC verbatim, so its `.getTime()` is NOT a real UTC instant. Applying
 * `timeZone: "Asia/Hebron"` straight to that value would shift twice: once
 * from the mis-tagging, once from this formatter. Instead, resolve the
 * naive value to a real instant first via
 * `"createdAt" AT TIME ZONE current_setting('TIMEZONE')` (the same
 * production-verified technique used everywhere else in this app — see
 * order-number.ts, payment-number.ts, and reporting.ts's
 * `businessCreatedAt`) and pass THAT Date here. This function then performs
 * the ONE remaining conversion — real UTC instant -> Asia/Hebron wall clock
 * — exactly once.
 */
export function formatBusinessDateTime(date: Date, locale: string = "ar"): string {
  return new Intl.DateTimeFormat(locale, {
    timeZone: "Asia/Hebron",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
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
