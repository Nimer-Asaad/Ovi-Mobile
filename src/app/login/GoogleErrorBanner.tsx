"use client";

import { useSearchParams } from "next/navigation";

const GOOGLE_ERROR_MESSAGES: Record<string, string> = {
  google_unavailable: "تسجيل الدخول بواسطة Google غير متاح حالياً.",
  google_state: "انتهت صلاحية الجلسة، يرجى المحاولة مرة أخرى.",
  google_denied: "تم إلغاء تسجيل الدخول بواسطة Google.",
  google_email_unverified: "يجب أن يكون البريد الإلكتروني في حساب Google موثّقاً.",
  google_inactive: "هذا الحساب غير مفعّل.",
  google_failed: "تعذّر تسجيل الدخول بواسطة Google. حاول مرة أخرى.",
};

/** Reads ?error=... set by /auth/google/callback and shows a matching
 * Arabic message. Isolated in its own client component (behind Suspense in
 * the page) so useSearchParams doesn't force the rest of /login off static
 * rendering. */
export function GoogleErrorBanner() {
  const searchParams = useSearchParams();
  const error = searchParams.get("error");
  if (!error) return null;

  const message = GOOGLE_ERROR_MESSAGES[error];
  if (!message) return null;

  return (
    <p className="rounded-card border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-sm text-rose-700" role="alert">
      {message}
    </p>
  );
}
