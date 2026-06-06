import type { Metadata } from "next";
import localFont from "next/font/local";
import "./globals.css";

const rubik = localFont({
  src: [
    {
      path: "../public/fonts/Rubik-VariableFont_wght.ttf",
      style: "normal",
      weight: "300 900",
    },
    {
      path: "../public/fonts/Rubik-Italic-VariableFont_wght.ttf",
      style: "italic",
      weight: "300 900",
    },
  ],
  variable: "--font-rubik",
  display: "swap",
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
    <html lang="en" className={`${rubik.variable} h-full`}>
      <body className="min-h-full flex flex-col font-[family-name:var(--font-rubik)]">
        {children}
      </body>
    </html>
  );
}
