import { CandlestickChart, LineChart, ShieldCheck, Sparkles } from "lucide-react";

const HIGHLIGHTS = [
  {
    icon: LineChart,
    title: "One master ledger",
    description: "Every dashboard number derives from a single Performance Account.",
  },
  {
    icon: CandlestickChart,
    title: "Journal that thinks",
    description: "Per-trade psychology scoring, checklists, and a real P&L calendar.",
  },
  {
    icon: ShieldCheck,
    title: "Private by design",
    description: "Multi-tenant and fully isolated — your desk is yours alone.",
  },
];

export function AuthBrandPanel() {
  return (
    <div className="relative hidden overflow-hidden lg:flex lg:flex-col lg:justify-between lg:p-12 xl:p-16">
      {/* gradient wash + grid texture */}
      <div className="bg-brand-gradient absolute inset-0 -z-10 opacity-90" />
      <div
        className="absolute inset-0 -z-10 opacity-[0.15]"
        style={{
          backgroundImage:
            "linear-gradient(to right, white 1px, transparent 1px), linear-gradient(to bottom, white 1px, transparent 1px)",
          backgroundSize: "44px 44px",
          maskImage: "radial-gradient(ellipse 80% 80% at 50% 0%, black, transparent 75%)",
        }}
      />
      <div
        className="absolute -top-24 -right-24 -z-10 size-96 rounded-full opacity-40 blur-3xl"
        style={{ background: "radial-gradient(circle, white, transparent 70%)" }}
      />

      <div className="flex items-center gap-2.5 text-white">
        <div className="flex size-9 items-center justify-center rounded-xl bg-white/15 ring-1 ring-white/25 backdrop-blur">
          <CandlestickChart className="size-5" />
        </div>
        <span className="text-lg font-semibold tracking-tight">Trading Hub</span>
      </div>

      <div className="max-w-md text-white">
        <div className="mb-4 inline-flex items-center gap-1.5 rounded-full bg-white/15 px-3 py-1 text-xs font-medium ring-1 ring-white/20 backdrop-blur">
          <Sparkles className="size-3.5" />
          Your private trading desk
        </div>
        <h1 className="text-4xl font-semibold leading-[1.1] tracking-tight xl:text-5xl">
          Trade with a clear head and a clean record.
        </h1>
        <p className="mt-4 text-base text-white/80">
          Plan, journal, and analyze every trade in one focused, beautifully quiet workspace.
        </p>

        <ul className="mt-10 space-y-5">
          {HIGHLIGHTS.map((h) => (
            <li key={h.title} className="flex gap-3.5">
              <div className="mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-lg bg-white/15 ring-1 ring-white/20 backdrop-blur">
                <h.icon className="size-4.5" />
              </div>
              <div>
                <p className="font-medium">{h.title}</p>
                <p className="text-sm text-white/70">{h.description}</p>
              </div>
            </li>
          ))}
        </ul>
      </div>

      <p className="text-sm text-white/60">Built for traders who take the process seriously.</p>
    </div>
  );
}
