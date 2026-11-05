import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono, Instrument_Serif } from "next/font/google";
import { CommandPaletteProvider } from "@/components/shell/command-palette";
import { SiteFooter } from "@/components/shell/site-footer";
import { SiteHeader } from "@/components/shell/site-header";
import { ThemeProvider } from "@/components/shell/theme-provider";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import "./globals.css";

const sans = Geist({ subsets: ["latin"], variable: "--font-geist-sans", display: "swap" });
const mono = Geist_Mono({ subsets: ["latin"], variable: "--font-geist-mono", display: "swap" });
const serif = Instrument_Serif({ subsets: ["latin"], weight: "400", variable: "--font-instrument-serif", display: "swap" });

export const metadata: Metadata = {
  title: { default: "ATLAS — Design system intelligence", template: "%s · ATLAS" },
  description:
    "A source-attributed index of real-world design systems: components, tokens, patterns and accessibility guidance, compared side by side.",
  applicationName: "ATLAS",
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: dark)", color: "#0f1115" },
    { media: "(prefers-color-scheme: light)", color: "#fbfbfc" },
  ],
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" suppressHydrationWarning className={`${sans.variable} ${mono.variable} ${serif.variable}`}>
      <body className="min-h-dvh font-sans">
        <ThemeProvider attribute="class" defaultTheme="system" enableSystem disableTransitionOnChange>
          <TooltipProvider delayDuration={250}>
            <CommandPaletteProvider>
              <a
                href="#main"
                className="sr-only z-50 rounded-md bg-primary px-3 py-2 text-primary-foreground focus:not-sr-only focus:fixed focus:top-2 focus:left-2"
              >
                Skip to content
              </a>
              <SiteHeader />
              <main id="main" className="min-h-[60vh]">
                {children}
              </main>
              <SiteFooter />
              <Toaster />
            </CommandPaletteProvider>
          </TooltipProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
