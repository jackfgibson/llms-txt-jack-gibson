import type { Metadata } from "next";
import localFont from "next/font/local";
import "./globals.css";
import { AppSidebar } from "@/components/app-sidebar";
import { SidebarInset, SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Toaster } from "@/components/ui/sonner";

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
      <body className="min-h-full font-[family-name:var(--font-rubik)]">
        <TooltipProvider>
          <SidebarProvider>
            <AppSidebar />
            <SidebarInset>
              <header className="flex h-12 items-center gap-2 px-4 border-b border-border md:hidden">
                <SidebarTrigger />
              </header>
              <main className="flex flex-1 flex-col">
                {children}
              </main>
            </SidebarInset>
          </SidebarProvider>
        </TooltipProvider>
        <Toaster position="bottom-right" />
      </body>
    </html>
  );
}
