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
    },
  },
  plugins: [],
};

export default config;
