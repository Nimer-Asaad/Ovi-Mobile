import type { Config } from "tailwindcss";

/**
 * Ovi Mobile brand tokens.
 * This is the single source of truth for color usage across the app.
 * Do not hardcode hex values in components — reference these tokens instead
 * (e.g. `bg-navy-deep`, `text-gold-champagne`).
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
          deep: "#0F172A", // primary background
          surface: "#111827", // cards / panels
          soft: "#1E293B", // elevated surfaces, borders
        },
        gold: {
          champagne: "#C8A97E", // primary accent
          light: "#D6B98C", // hover / highlight
          dark: "#A8844F", // active / pressed
        },
        neutral: {
          bg: "#F8FAFC", // light-mode background
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
        card: "0 4px 24px -4px rgba(15, 23, 42, 0.35)",
      },
    },
  },
  plugins: [],
};

export default config;
