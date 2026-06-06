import type { Metadata } from "next";
import localFont from "next/font/local";
import "./globals.css";

const pixelifySans = localFont({
  src: "../public/fonts/PixelifySans.ttf",
  variable: "--font-pixelify",
  display: "swap",
  weight: "100 900",
});

export const metadata: Metadata = {
  title: "Crawl Atlas",
  description: "An LLMs.txt Generator for the AI Era",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className={`${pixelifySans.variable} h-full`}>
      <body className="min-h-full flex flex-col font-[family-name:var(--font-pixelify)]">
        {children}
      </body>
    </html>
  );
}
