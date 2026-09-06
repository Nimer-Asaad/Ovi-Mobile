"use client";

import { useRef, useState, type ReactNode } from "react";
import { toPng } from "html-to-image";
import { Button } from "@/components/ui/Button";
import { buildWhatsAppChatUrl } from "@/lib/phone";

interface DocumentShareActionsProps {
  /** The document body to render+capture — InvoiceView, PaymentReceiptView,
   * or any future printable/shareable document. Wrapped tightly by the ref
   * html-to-image captures, with nothing else inside it, so the exported
   * image (and the print output, both via `print:hidden` here and the
   * document's own `print:` classes) never includes these buttons or any
   * page chrome. */
  children: ReactNode;
  /** Arabic noun used in every button/status message this component builds
   * (e.g. "الفاتورة" or "سند القبض") — kept a plain prop rather than
   * hardcoding one document type, so this same print/PNG/WhatsApp logic
   * serves every document type without a second copy of it. */
  documentLabel: string;
  /** Filename WITHOUT extension, e.g. "ovi-invoice-OVI-20260907-0001" or
   * "ovi-payment-PAY-20260907-A1B2C3" — ".png" is appended here. */
  fileNameBase: string;
  /** Full WhatsApp message text to send/prefill — built by the caller, since
   * each document type has its own wording/fields. */
  shareText: string;
  /** Merchant.whatsappPhone, falling back to contactPhone when no separate
   * WhatsApp number was saved — already resolved by the caller, never
   * re-derived here. Null when there's no merchant, or neither number was
   * saved. */
  whatsappNumber: string | null;
  /** e.g. "طباعة الفاتورة" | "طباعة سند القبض". */
  printLabel: string;
}

/** The one place that generates a shareable PNG of a document and drives
 * print/WhatsApp — extracted from the original invoice-only InvoiceActions
 * so a second document type (the payment receipt) never duplicates this
 * image-generation/share logic. InvoiceActions is now a thin wrapper around
 * this component; PaymentReceiptActions is the other. */
export function DocumentShareActions({ children, documentLabel, fileNameBase, shareText, whatsappNumber, printLabel }: DocumentShareActionsProps) {
  const docRef = useRef<HTMLDivElement>(null);
  const [isBusy, setIsBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const imageErrorMessage = `تعذر إنشاء صورة ${documentLabel}، حاول مرة أخرى`;

  /** Renders the ref'd document node to a PNG File — pixelRatio: 2 for a
   * crisp, WhatsApp/screenshot-suitable resolution (clear Arabic text)
   * without ballooning file size/generation time on a rep's phone.
   * backgroundColor guards against any transparent edge showing through as
   * black/transparent in the exported file, since every document here is
   * already an opaque white card. Returns null (never throws) on any
   * failure — DOM export can fail for reasons outside our control (e.g. a
   * cross-origin image without CORS headers), so callers always check for
   * null and show imageErrorMessage rather than crashing the page. */
  async function generatePngFile(): Promise<File | null> {
    if (!docRef.current) return null;
    try {
      const dataUrl = await toPng(docRef.current, {
        pixelRatio: 2,
        backgroundColor: "#ffffff",
        cacheBust: true,
      });
      const response = await fetch(dataUrl);
      const blob = await response.blob();
      return new File([blob], `${fileNameBase}.png`, { type: "image/png" });
    } catch {
      return null;
    }
  }

  function downloadFile(file: File): void {
    const url = URL.createObjectURL(file);
    const link = document.createElement("a");
    link.href = url;
    link.download = file.name;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  }

  async function handleDownload() {
    setMessage(null);
    setIsBusy(true);
    const file = await generatePngFile();
    setIsBusy(false);
    if (!file) {
      setMessage(imageErrorMessage);
      return;
    }
    downloadFile(file);
  }

  async function handleWhatsApp() {
    setMessage(null);
    setIsBusy(true);
    const file = await generatePngFile();
    setIsBusy(false);
    if (!file) {
      setMessage(imageErrorMessage);
      return;
    }

    // Web Share API with an actual file attached — the only real way a
    // browser can hand WhatsApp the generated PNG directly. Feature-detected
    // via canShare({files}), never assumed from a user-agent string; only
    // some mobile browsers (mainly Android Chrome, some iOS Safari versions)
    // support it. Sharing this way still opens the OS share sheet — the
    // user picks WhatsApp (and, inside WhatsApp, the contact) themselves; no
    // browser API can pre-select a specific WhatsApp chat.
    const nav = typeof navigator === "undefined" ? null : navigator;
    const canShareFiles = Boolean(nav?.share && nav.canShare?.({ files: [file] }));

    if (canShareFiles && nav) {
      try {
        await nav.share({ files: [file], text: shareText });
        return;
      } catch (err) {
        // AbortError = the user cancelled the share sheet themselves — a
        // deliberate choice, not a failure, so no fallback download follows.
        if (err instanceof Error && err.name === "AbortError") return;
        // Any other error: fall through to the desktop/fallback flow below.
      }
    }

    // Fallback (desktop, or a mobile browser without file-share support):
    // download the PNG, then open a WhatsApp chat with a prefilled text
    // message. Browsers cannot attach a generated file into a specific
    // WhatsApp chat via a wa.me URL — so this never claims the image itself
    // was sent; the user attaches the just-downloaded file by hand.
    downloadFile(file);
    if (whatsappNumber) {
      const chatUrl = buildWhatsAppChatUrl(whatsappNumber, shareText);
      if (chatUrl) window.open(chatUrl, "_blank", "noopener,noreferrer");
      setMessage(`تم تحميل صورة ${documentLabel}. افتح المحادثة وأرفق الصورة المحمّلة.`);
    } else {
      setMessage(`لا يوجد رقم واتساب محفوظ لهذا التاجر. تم تحميل صورة ${documentLabel} — يمكنك إرفاقها يدوياً من واتساب.`);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap gap-2 print:hidden">
        <Button type="button" onClick={() => window.print()} className="flex-1 sm:flex-none">
          {printLabel}
        </Button>
        <Button type="button" variant="outline" disabled={isBusy} onClick={handleDownload} className="flex-1 sm:flex-none">
          {isBusy ? "جارٍ التجهيز..." : "تحميل كصورة"}
        </Button>
        <Button type="button" variant="outline" disabled={isBusy} onClick={handleWhatsApp} className="flex-1 sm:flex-none">
          {isBusy ? "جارٍ التجهيز..." : "إرسال عبر واتساب"}
        </Button>
      </div>

      {message && (
        <p className="text-sm text-neutral-bg/70 print:hidden" role="status">
          {message}
        </p>
      )}

      <div ref={docRef}>{children}</div>
    </div>
  );
}
