import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./app/**/*.{ts,tsx}",
    "../../packages/ui/src/**/*.{ts,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        background: "#F8FAFC",
        "dark-gold": "#A8844F",
        "deep-navy": "#0F172A",
        gold: "#C8A97E",
        "light-gold": "#D6B98C",
        "navy-surface": "#111827",
        "soft-navy": "#1E293B",
      },
      fontFamily: {
        sans: ["var(--font-geist-sans)", "Arial", "sans-serif"],
      },
    },
  },
  plugins: [],
};

export default config;
