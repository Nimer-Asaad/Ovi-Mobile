"use client";

import { useEffect, useRef, useState } from "react";
import { usePathname, useSearchParams } from "next/navigation";

/** Never leave the bar on screen forever if a navigation is aborted, fails,
 * or the target page just never finishes (offline, server error, etc). */
const SAFETY_TIMEOUT_MS = 5000;

/** Slim top progress bar shown for the gap between "user clicked an
 * internal link" and "the new route has rendered". Deliberately hand-rolled
 * (no nprogress-style dependency) — Next's App Router gives no direct
 * navigation-start event, so this listens for qualifying clicks itself and
 * clears on the next pathname/searchParams change, which fires once the new
 * route has actually rendered. */
export function NavigationProgress() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [visible, setVisible] = useState(false);
  const safetyTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // The route (or just the query string) changed — navigation is done.
  useEffect(() => {
    setVisible(false);
    if (safetyTimeoutRef.current) {
      clearTimeout(safetyTimeoutRef.current);
      safetyTimeoutRef.current = null;
    }
  }, [pathname, searchParams]);

  useEffect(() => {
    function handleClick(event: MouseEvent) {
      if (event.defaultPrevented) return;
      if (event.button !== 0) return; // only plain left-click (ignores middle/right click)
      if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return; // modified clicks open in new tab/window

      const anchor = (event.target as HTMLElement | null)?.closest("a");
      if (!anchor) return;
      if (anchor.target && anchor.target !== "_self") return; // target="_blank" etc.
      if (anchor.hasAttribute("download")) return;

      const rawHref = anchor.getAttribute("href");
      if (!rawHref || /^(mailto:|tel:|sms:)/i.test(rawHref)) return;

      let url: URL;
      try {
        url = new URL(anchor.href, window.location.href);
      } catch {
        return;
      }

      if (url.origin !== window.location.origin) return; // external link — full page load

      const samePage = url.pathname === window.location.pathname && url.search === window.location.search;
      if (samePage && url.hash) return; // in-page anchor scroll
      if (url.href === window.location.href) return; // clicking the current URL again

      setVisible(true);
      if (safetyTimeoutRef.current) clearTimeout(safetyTimeoutRef.current);
      safetyTimeoutRef.current = setTimeout(() => setVisible(false), SAFETY_TIMEOUT_MS);
    }

    document.addEventListener("click", handleClick);
    return () => document.removeEventListener("click", handleClick);
  }, []);

  if (!visible) return null;

  return (
    <div aria-hidden="true" className="fixed inset-x-0 top-0 z-[60] h-0.5 overflow-hidden bg-transparent">
      <div className="h-full w-1/3 animate-nav-progress rounded-full bg-gold-champagne shadow-lg" />
    </div>
  );
}
