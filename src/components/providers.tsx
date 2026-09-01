"use client";

import { SessionProvider } from "next-auth/react";
import { ThemeProvider } from "next-themes";

import { TooltipProvider } from "@/components/ui/tooltip";
import { Toaster } from "@/components/ui/sonner";

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <ThemeProvider
      attribute="class"
      defaultTheme="dark"
      enableSystem={false}
      disableTransitionOnChange={false}
    >
      <SessionProvider>
        <TooltipProvider>
          {children}
          <Toaster
            richColors
            position="top-right"
            closeButton
            duration={3500}
            visibleToasts={3}
          />
        </TooltipProvider>
      </SessionProvider>
    </ThemeProvider>
  );
}
