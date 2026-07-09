import { CandlestickChart } from "lucide-react";

import { AuthBrandPanel } from "@/components/auth/auth-brand-panel";
import { ThemeToggle } from "@/components/shared/theme-toggle";

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="grid min-h-screen w-full lg:grid-cols-2">
      <AuthBrandPanel />

      <div className="relative flex flex-col items-center justify-center p-6 sm:p-10">
        <div className="absolute top-5 right-5">
          <ThemeToggle />
        </div>

        {/* Compact brand mark for the mobile / narrow layout */}
        <div className="mb-8 flex items-center gap-2.5 lg:hidden">
          <div className="bg-brand-gradient flex size-9 items-center justify-center rounded-xl text-white shadow-glow">
            <CandlestickChart className="size-5" />
          </div>
          <span className="text-lg font-semibold tracking-tight">Trading Hub</span>
        </div>

        <div className="w-full max-w-sm">{children}</div>
      </div>
    </div>
  );
}
