"use client";

import { useRef, useState } from "react";
import { toPng } from "html-to-image";
import { Button } from "@/components/ui/Button";
import { buildWhatsAppChatUrl } from "@/lib/phone";
import { InvoiceView, type InvoiceData } from "./InvoiceView";

interface InvoiceActionsProps {
  order: InvoiceData;
  /** Merchant.whatsappPhone, falling back to contactPhone when no separate
   * WhatsApp number was saved — already resolved by the caller (the invoice
   * page), never re-derived here. Null when the order has no merchant, or
   * the merchant has neither number saved. */
  whatsappNumber: string | null;
}

const IMAGE_ERROR_MESSAGE = "تعذر إنشاء صورة الفاتورة، حاول مرة أخرى";
const SHARE_TEXT_PREFIX = "السلام عليكم، هذه فاتورتك من Ovi Mobile";

/** The one place that generates a shareable PNG of the invoice and drives
 * print/WhatsApp — owns the DOM ref html-to-image captures, wrapped tightly
 * around InvoiceView alone so the exported image (and the print output,
 * both via `print:hidden` here and InvoiceView's own `print:` classes) never
 * includes these buttons or any page chrome. InvoiceView stays the single
 * source of invoice markup; this component is purely the interactive shell
 * around it, reused as-is by both /rep/sales/[orderNumber] and
 * /admin/orders/[orderNumber]/invoice. */
export function InvoiceActions({ order, whatsappNumber }: InvoiceActionsProps) {
  const invoiceRef = useRef<HTMLDivElement>(null);
  const [isBusy, setIsBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  /** Renders the ref'd invoice node to a PNG File — pixelRatio: 2 for a
   * crisp, WhatsApp/screenshot-suitable resolution (clear Arabic text)
   * without ballooning file size/generation time on a rep's phone.
   * backgroundColor guards against any transparent edge showing through as
   * black/transparent in the exported file, since InvoiceView's own card is
   * already opaque white. Returns null (never throws) on any failure — DOM
   * export can fail for reasons outside our control (e.g. a cross-origin
   * product image without CORS headers), so callers always check for null
   * and show IMAGE_ERROR_MESSAGE rather than crashing the page. */
  async function generatePngFile(): Promise<File | null> {
    if (!invoiceRef.current) return null;
    try {
      const dataUrl = await toPng(invoiceRef.current, {
        pixelRatio: 2,
        backgroundColor: "#ffffff",
        cacheBust: true,
      });
      const response = await fetch(dataUrl);
      const blob = await response.blob();
      return new File([blob], `ovi-invoice-${order.orderNumber}.png`, { type: "image/png" });
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
      setMessage(IMAGE_ERROR_MESSAGE);
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
      setMessage(IMAGE_ERROR_MESSAGE);
      return;
    }

    const shareText = `${SHARE_TEXT_PREFIX}\nرقم الفاتورة: ${order.orderNumber}`;

    // Web Share API with an actual file attached — the only real way a
    // browser can hand WhatsApp the generated PNG directly. Feature-detected
    // via canShare({files}), never assumed from a user-agent string; only
    // some mobile browsers (mainly Android Chrome, some iOS Safari versions)
    // support it. Sharing this way still opens the OS share sheet — the rep
    // picks WhatsApp (and, inside WhatsApp, the contact) themselves; no
    // browser API can pre-select a specific WhatsApp chat.
    const nav = typeof navigator === "undefined" ? null : navigator;
    const canShareFiles = Boolean(nav?.share && nav.canShare?.({ files: [file] }));

    if (canShareFiles && nav) {
      try {
        await nav.share({ files: [file], text: shareText });
        return;
      } catch (err) {
        // AbortError = the rep cancelled the share sheet themselves — a
        // deliberate choice, not a failure, so no fallback download follows.
        if (err instanceof Error && err.name === "AbortError") return;
        // Any other error: fall through to the desktop/fallback flow below.
      }
    }

    // Fallback (desktop, or a mobile browser without file-share support):
    // download the PNG, then open a WhatsApp chat with a prefilled text
    // message. Browsers cannot attach a generated file into a specific
    // WhatsApp chat via a wa.me URL — so this never claims the image itself
    // was sent; the rep attaches the just-downloaded file by hand.
    downloadFile(file);
    if (whatsappNumber) {
      const chatUrl = buildWhatsAppChatUrl(whatsappNumber, shareText);
      if (chatUrl) window.open(chatUrl, "_blank", "noopener,noreferrer");
      setMessage("تم تحميل صورة الفاتورة. افتح المحادثة وأرفق الصورة المحمّلة للفاتورة.");
    } else {
      setMessage("لا يوجد رقم واتساب محفوظ لهذا التاجر. تم تحميل صورة الفاتورة — يمكنك إرفاقها يدوياً من واتساب.");
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap gap-2 print:hidden">
        <Button type="button" onClick={() => window.print()} className="flex-1 sm:flex-none">
          طباعة الفاتورة
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

      <div ref={invoiceRef}>
        <InvoiceView order={order} />
      </div>
    </div>
  );
}
