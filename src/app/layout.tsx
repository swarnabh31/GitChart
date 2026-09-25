import type { Metadata } from "next";
import { ThemeProvider } from "next-themes";
import * as React from "react";
import { Sparkles } from "lucide-react";
import { ThemeToggle } from "../components/ThemeToggle";
import "./globals.css";

export const metadata: Metadata = {
  title: "GitChart — GitHub repos as live architecture diagrams",
  description:
    "Paste a GitHub repository URL and get a Mermaid architecture diagram, a streamed explanation of how the pieces talk.",
  applicationName: "GitChart",
};

function AppShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-full flex flex-col">
      <header className="gd-container flex items-center justify-between py-5">
        <a href="/" className="inline-flex items-center gap-2 font-semibold text-ink">
          <span className="w-8 h-8 rounded-lg bg-accent-soft flex items-center justify-center">
            <Sparkles className="w-5 h-5 text-accent" />
          </span>
          GitChart
        </a>
        <ThemeToggle />
      </header>
      <div className="flex-1">{children}</div>
      <footer className="gd-container flex items-center justify-between py-6 text-xs text-ink-mut">
        <span>Mermaid diagrams · PNG export</span>
        <span>Built with the GitHub + Mermaid stack</span>
      </footer>
    </div>
  );
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className="min-h-screen bg-surface text-ink antialiased">
        <ThemeProvider attribute="class" defaultTheme="system" enableSystem disableTransitionOnChange>
          <AppShell>{children}</AppShell>
        </ThemeProvider>
      </body>
    </html>
  );
}
