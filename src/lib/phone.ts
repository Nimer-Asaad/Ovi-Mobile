/** Palestinian phone numbers are stored in plain local format everywhere in
 * this app (e.g. "0599123456") — see the doc comment on
 * merchantProfileFields in src/lib/validation/merchant.ts: no format regex
 * is enforced anywhere, on purpose. A wa.me chat link needs the FULL
 * international number instead — no leading zero, no "+", e.g.
 * "970599123456" — this is the one place in the app that needs that
 * conversion, so it lives here rather than being duplicated ad hoc.
 *
 * Deliberately conservative — never invents a country code the input
 * doesn't already imply:
 * - Strips everything but digits.
 * - Already starts with "970" or "972" (an international-format Palestinian
 *   number already carries its own country code — both are commonly used in
 *   practice for Jawwal/Ooredoo numbers) — used exactly as-is.
 * - A single leading "0" (the normal local format everywhere in this app)
 *   is replaced with "970", Palestine's assigned ITU country code.
 * - Anything else (too short, or an unrecognized shape) is returned as-is —
 *   never guessed further; buildWhatsAppChatUrl still builds a link from it,
 *   since a malformed number is a data problem for the admin to fix, not a
 *   reason to silently produce no link at all. */
export function normalizePhoneForWhatsApp(rawPhone: string): string | null {
  const digits = rawPhone.replace(/\D/g, "");
  if (!digits) return null;
  if (digits.startsWith("970") || digits.startsWith("972")) return digits;
  if (digits.startsWith("0")) {
    const withoutLeadingZero = digits.slice(1);
    // Guards against a stray extra leading zero in front of an already-
    // international number (e.g. "0970599123456") — use the remainder
    // as-is instead of prepending a second "970" on top of it.
    if (withoutLeadingZero.startsWith("970") || withoutLeadingZero.startsWith("972")) {
      return withoutLeadingZero;
    }
    return `970${withoutLeadingZero}`;
  }
  return digits;
}

/** A wa.me chat link with a prefilled message — opens WhatsApp (the native
 * app on mobile, WhatsApp Web on desktop) with that text ready to send.
 * Cannot attach a file: browsers have no way to hand a specific chat a
 * generated image through this URL scheme — see InvoiceActions, which
 * downloads the invoice PNG separately for the rep to attach by hand.
 * Returns null when `rawPhone` is empty/unusable, so callers can fall back
 * to "no WhatsApp number" messaging instead of opening a broken link. */
export function buildWhatsAppChatUrl(rawPhone: string, message: string): string | null {
  const normalized = normalizePhoneForWhatsApp(rawPhone);
  if (!normalized) return null;
  return `https://wa.me/${normalized}?text=${encodeURIComponent(message)}`;
}
