import type { Config } from "tailwindcss";

/**
 * Ovi Mobile brand tokens.
 * This is the single source of truth for color usage across the app.
 * Do not hardcode hex values in components — reference these tokens instead
 * (e.g. `bg-navy-deep`, `text-gold-champagne`).
 *
 * Phase 13: token *names* are kept stable (navy.*, gold.*, neutral.bg) so no
 * component classNames needed to change, but the hex values now implement a
 * light theme instead of the original dark one — navy.deep is the page
 * background (light), navy.surface is the white card surface, gold.* is a
 * teal/cyan accent, and neutral.bg is the primary (dark) text color. Every
 * existing `text-neutral-bg/50..80` opacity variant still works and now
 * produces correctly muted grays automatically.
 */
const config: Config = {
  darkMode: "class",
  content: [
    "./src/app/**/*.{ts,tsx}",
    "./src/components/**/*.{ts,tsx}",
    "./src/lib/**/*.{ts,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        navy: {
          deep: "#F5F7FA", // page background (light)
          surface: "#FFFFFF", // cards / panels (white)
          soft: "#E2E8F0", // borders, dividers, subtle hover tints
        },
        gold: {
          champagne: "#18B7D3", // primary accent (teal)
          light: "#4CC9DE", // lighter accent
          dark: "#0F96AE", // active / pressed accent
        },
        neutral: {
          bg: "#0F172A", // primary text (dark)
        },
        // Phase 15: dark navy "chrome" — used ONLY for the public Header,
        // AdminSidebar, and AdminTopbar (including its mobile nav strip).
        // Everything else (page backgrounds, cards, tables, forms) stays on
        // the light navy.* tokens above — do not use chrome.* for content.
        chrome: {
          DEFAULT: "#081827", // dark navy chrome background
          surface: "#0F2438", // lighter navy — hover/active rows on chrome
          border: "#1B324A", // subtle border within dark chrome
        },
      },
      fontFamily: {
        sans: [
          "var(--font-sans)",
          "system-ui",
          "sans-serif",
        ],
        arabic: [
          "var(--font-arabic)",
          "Tahoma",
          "sans-serif",
        ],
      },
      borderRadius: {
        card: "0.75rem",
      },
      boxShadow: {
        card: "0 1px 2px 0 rgba(15, 23, 42, 0.04), 0 4px 16px -4px rgba(15, 23, 42, 0.08)",
      },
      keyframes: {
        "nav-progress": {
          "0%": { transform: "translateX(-100%)" },
          "50%": { transform: "translateX(10%)" },
          "100%": { transform: "translateX(100%)" },
        },
        "fade-in": {
          from: { opacity: "0", transform: "translateY(4px)" },
          to: { opacity: "1", transform: "translateY(0)" },
        },
        "van-float": {
          "0%, 100%": { transform: "translateY(0)" },
          "50%": { transform: "translateY(-5px)" },
        },
        "road-line": {
          "0%": { backgroundPositionX: "0px" },
          "100%": { backgroundPositionX: "-64px" },
        },
      },
      animation: {
        "nav-progress": "nav-progress 1s ease-in-out infinite",
        "fade-in": "fade-in 0.4s ease-out both",
        "van-float": "van-float 3.2s ease-in-out infinite",
        "road-line": "road-line 1.1s linear infinite",
      },
    },
  },
  plugins: [],
};

export default config;
