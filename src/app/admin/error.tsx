"use client";

import { useEffect } from "react";
import { Button } from "@/components/ui/Button";

/**
 * Admin-area error boundary — catches unhandled errors under /admin (the
 * sidebar/topbar shell from admin/layout.tsx stays mounted; only this
 * content area is replaced). The original error is still logged
 * server-side by Next.js; `console.error` here only mirrors it to the
 * browser console for local debugging.
 */
export default function AdminError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <div className="flex min-h-[50vh] flex-col items-center justify-center gap-4 text-center">
      <div className="max-w-md rounded-card border border-navy-soft bg-navy-surface px-6 py-10">
        <h1 className="text-lg font-semibold text-neutral-bg">حدث خطأ غير متوقع</h1>
        <p className="mt-2 text-sm text-neutral-bg/60">
          تعذّر تحميل هذا القسم. يرجى المحاولة مرة أخرى، وإذا استمرت المشكلة تواصل مع الدعم الفني.
        </p>
        <div className="mt-6 flex justify-center gap-3">
          <Button onClick={reset}>حاول مرة أخرى</Button>
        </div>
      </div>
    </div>
  );
}
