import type { Metadata } from "next";
import type { ReactNode } from "react";
import { AppShell } from "@/components/AppShell";
import { ThemeProvider } from "@/components/ThemeProvider";
import { THEME_INIT_SCRIPT } from "@/lib/theme";
import "./globals.css";

export const metadata: Metadata = {
  title: "WAITLESS – Hospital Resource Management Simulator",
  description:
    "A hospital operations simulation and decision-support prototype that compares patient-scheduling strategies. Synthetic data only; not a clinical system.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    // data-theme is overwritten before first paint by THEME_INIT_SCRIPT (saved choice, else system);
    // suppressHydrationWarning tells React to keep that DOM value (Next.js: preventing-flash-before-hydration).
    <html lang="en" data-theme="light" className="h-full antialiased" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />
      </head>
      <body className="min-h-full">
        <ThemeProvider>
          <AppShell>{children}</AppShell>
        </ThemeProvider>
      </body>
    </html>
  );
}
