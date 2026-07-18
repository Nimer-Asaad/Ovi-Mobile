"use client";

import { useState, type ReactNode } from "react";
import { Button } from "@/components/ui/Button";

interface ConfirmDialogProps {
  /** Renders the trigger element; call the given `open` function from its
   * onClick. Lets callers keep full control over the trigger's own styling
   * (a table row button, a form submit button, etc.). */
  trigger: (open: () => void) => ReactNode;
  title: string;
  description: ReactNode;
  confirmLabel: string;
  cancelLabel?: string;
  onConfirm: () => void;
  variant?: "danger" | "default";
}

/** Minimal, dependency-free confirmation modal used for every sensitive
 * admin action in the Users section (role change, account enable/disable) —
 * confirming here only calls `onConfirm`, it never submits anything itself,
 * so the caller's own form/action stays the single source of truth. */
export function ConfirmDialog({
  trigger,
  title,
  description,
  confirmLabel,
  cancelLabel = "إلغاء",
  onConfirm,
  variant = "default",
}: ConfirmDialogProps) {
  const [open, setOpen] = useState(false);

  return (
    <>
      {trigger(() => setOpen(true))}
      {open && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="confirm-dialog-title"
        >
          <div className="w-full max-w-sm rounded-card border border-navy-soft bg-navy-surface p-6 shadow-card">
            <h3 id="confirm-dialog-title" className="text-base font-semibold text-neutral-bg">
              {title}
            </h3>
            <div className="mt-2 text-sm text-neutral-bg/70">{description}</div>
            <div className="mt-6 flex justify-end gap-3">
              <Button variant="outline" type="button" onClick={() => setOpen(false)}>
                {cancelLabel}
              </Button>
              <Button
                type="button"
                className={variant === "danger" ? "bg-rose-600 text-white hover:bg-rose-700 focus-visible:ring-rose-500" : undefined}
                onClick={() => {
                  setOpen(false);
                  onConfirm();
                }}
              >
                {confirmLabel}
              </Button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
