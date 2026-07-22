"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";

export interface MobileFilterDrawerProps {
  activeFilterCount: number;
  children: ReactNode;
}

const FOCUSABLE = 'a[href], button:not([disabled]), select:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])';

export function MobileFilterDrawer({ activeFilterCount, children }: MobileFilterDrawerProps) {
  const [mounted, setMounted] = useState(false);
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);

  useEffect(() => setMounted(true), []);
  useEffect(() => {
    if (!open) return;
    const trigger = triggerRef.current;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    closeRef.current?.focus();

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setOpen(false);
        return;
      }
      if (event.key !== "Tab") return;
      const focusable = Array.from(dialogRef.current?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? []);
      if (focusable.length === 0) return;
      const first = focusable[0]!;
      const last = focusable[focusable.length - 1]!;
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }

    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      document.body.style.overflow = previousOverflow;
      trigger?.focus();
    };
  }, [open]);

  return (
    <>
      <button ref={triggerRef} type="button" onClick={() => setOpen(true)} aria-haspopup="dialog" aria-expanded={open} className="relative inline-flex min-h-11 items-center justify-center gap-2 rounded-card border border-navy-soft bg-navy-surface px-4 text-sm font-semibold text-neutral-bg lg:hidden">
        الفلاتر
        {activeFilterCount > 0 && <span className="flex h-5 min-w-5 items-center justify-center rounded-full bg-gold-champagne px-1 text-[11px] font-bold text-white">{activeFilterCount}</span>}
      </button>

      {mounted && open && createPortal(
        <>
          <div aria-hidden="true" onClick={() => setOpen(false)} className="fixed inset-0 z-[100] bg-black/50" />
          <div ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby="mobile-filter-title" className="fixed inset-y-0 start-0 z-[110] flex w-[min(92vw,25rem)] flex-col overflow-hidden bg-navy-surface shadow-2xl">
            <div className="flex items-center justify-between border-b border-navy-soft bg-chrome px-5 py-4">
              <h2 id="mobile-filter-title" className="font-semibold text-white">الفلاتر</h2>
              <button ref={closeRef} type="button" onClick={() => setOpen(false)} aria-label="إغلاق الفلاتر" className="rounded-card p-2 text-white/75 hover:bg-white/10 focus-visible:outline focus-visible:outline-2 focus-visible:outline-gold-light">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true" className="h-5 w-5"><path d="M18 6 6 18M6 6l12 12" /></svg>
              </button>
            </div>
            <div className="flex-1 overflow-y-auto overflow-x-hidden p-5" onClick={(event) => {
              if ((event.target as HTMLElement).closest("a")) setOpen(false);
            }}>{children}</div>
            <div className="border-t border-navy-soft p-4">
              <Link href="/products" onClick={() => setOpen(false)} className="flex min-h-11 items-center justify-center rounded-card border border-gold-champagne/45 text-sm font-semibold text-gold-dark">مسح كل الفلاتر</Link>
            </div>
          </div>
        </>,
        document.body,
      )}
    </>
  );
}
