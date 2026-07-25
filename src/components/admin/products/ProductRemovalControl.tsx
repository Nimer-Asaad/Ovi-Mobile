"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ConfirmDialog } from "@/components/admin/ConfirmDialog";
import { Button } from "@/components/ui/Button";
import type { ProductRemovalResult } from "@/app/admin/products/actions";

interface ProductRemovalControlProps {
  productName: string;
  mode: "archive" | "delete" | "blocked";
  blockingInventoryQuantity: number;
  action: () => Promise<ProductRemovalResult>;
}

export function ProductRemovalControl({
  productName,
  mode,
  blockingInventoryQuantity,
  action,
}: ProductRemovalControlProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [message, setMessage] = useState<{ text: string; ok: boolean } | null>(null);

  if (mode === "blocked") {
    return (
      <div className="flex flex-col items-end gap-1">
        <Button type="button" size="sm" variant="outline" disabled className="border-rose-300 text-rose-700">
          حذف المنتج
        </Button>
        <span className="max-w-48 text-end text-xs text-rose-700">
          توجد كمية مخزون غير صفرية ({blockingInventoryQuantity})؛ عالج المخزون أولًا.
        </span>
      </div>
    );
  }

  const description =
    mode === "archive"
      ? "هذا المنتج مرتبط بسجلات سابقة، لذلك سيتم إخفاؤه وأرشفته بدل حذفه نهائيًا."
      : "سيتم حذف هذا المنتج نهائيًا لأنه غير مرتبط بأي طلبات أو حركات مخزون.";

  return (
    <div className="flex flex-col items-end gap-1">
      <ConfirmDialog
        title={mode === "archive" ? "أرشفة المنتج" : "حذف المنتج نهائيًا"}
        description={
          <div className="flex flex-col gap-2">
            <p>{description}</p>
            <p className="font-medium text-neutral-bg">{productName}</p>
          </div>
        }
        confirmLabel={mode === "archive" ? "أرشفة المنتج" : "حذف نهائي"}
        variant="danger"
        onConfirm={() => {
          if (isPending) return;
          setMessage(null);
          startTransition(async () => {
            const result = await action();
            setMessage({ text: result.message, ok: result.ok });
            if (result.ok) router.refresh();
          });
        }}
        trigger={(open) => (
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={isPending}
            onClick={open}
            className="border-rose-400 text-rose-700 hover:border-rose-500 hover:bg-rose-50"
          >
            {isPending ? "جارٍ التنفيذ..." : "حذف المنتج"}
          </Button>
        )}
      />
      {message && (
        <span role={message.ok ? "status" : "alert"} className={`max-w-56 text-end text-xs ${message.ok ? "text-emerald-700" : "text-rose-700"}`}>
          {message.text}
        </span>
      )}
    </div>
  );
}
