import { AuthBrandPanel } from "@/components/auth/auth-brand-panel";
import { TraditoriumMark } from "@/components/brand/traditorium-mark";
import { ThemeToggle } from "@/components/shared/theme-toggle";

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="grid min-h-screen w-full lg:grid-cols-2">
      <AuthBrandPanel />

      <div className="relative flex flex-col items-center justify-center overflow-hidden p-6 sm:p-10">
        {/* Ambient depth so the form panel reads as a lit surface, not a void. */}
        <div
          aria-hidden
          className="pointer-events-none absolute -top-1/4 left-1/2 -z-10 h-[60rem] w-[60rem] -translate-x-1/2 rounded-full opacity-60"
          style={{
            background:
              "radial-gradient(circle, color-mix(in oklch, var(--brand) 16%, transparent), transparent 60%)",
          }}
        />
        <div className="absolute top-5 right-5">
          <ThemeToggle />
        </div>

        {/* Compact brand mark for the mobile / narrow layout */}
        <div className="mb-8 flex items-center gap-2.5 lg:hidden">
          <div className="bg-brand-gradient flex size-9 items-center justify-center rounded-xl text-white shadow-glow">
            <TraditoriumMark className="size-5" />
          </div>
          <span className="text-lg font-semibold tracking-tight">
            Tradit<span className="font-mono font-medium text-primary">orium</span>
          </span>
        </div>

        <div className="w-full max-w-sm">{children}</div>
      </div>
    </div>
  );
}
