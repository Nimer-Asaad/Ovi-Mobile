"use client";

import { useEffect } from "react";
import { Button } from "@/components/ui/Button";

/**
 * Root error boundary — catches any unhandled error thrown while rendering
 * a Server or Client Component under this route tree (including transient
 * DB/connection errors) and shows a clean Arabic fallback instead of
 * Next.js's default error screen. The original error is still logged
 * server-side by Next.js before this boundary ever renders; the
 * `console.error` below only mirrors it to the browser console for local
 * debugging — nothing here suppresses server logging.
 */
export default function GlobalError({
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
    <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-navy-deep px-4 text-center">
      <div className="max-w-md rounded-card border border-navy-soft bg-navy-surface px-6 py-10">
        <h1 className="text-lg font-semibold text-neutral-bg">حدث خطأ غير متوقع</h1>
        <p className="mt-2 text-sm text-neutral-bg/60">
          نعتذر عن الإزعاج، حدثت مشكلة أثناء تحميل هذه الصفحة. يرجى المحاولة مرة أخرى.
        </p>
        <div className="mt-6 flex justify-center gap-3">
          <Button onClick={reset}>حاول مرة أخرى</Button>
        </div>
      </div>
    </div>
  );
}
