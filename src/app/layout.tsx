import type { Metadata } from "next";
import { Cairo, Inter } from "next/font/google";
import "./globals.css";

const cairo = Cairo({
  subsets: ["arabic", "latin"],
  variable: "--font-arabic",
  display: "swap",
});

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-sans",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Ovi Mobile",
  description: "إكسسوارات موبايل مميزة — بيع بالتجزئة والجملة",
};

/**
 * Root layout. Arabic RTL is the default document direction; a language
 * switcher / LTR mode is a Phase 10 (i18n polish) concern, not Phase 1.
 */
export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ar" dir="rtl" className={`${cairo.variable} ${inter.variable}`}>
      <body className="font-arabic">{children}</body>
    </html>
  );
}
