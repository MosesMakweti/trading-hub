"use client";

import { CandlestickChart, LineChart, ShieldCheck, Sparkles } from "lucide-react";
import { motion, useReducedMotion, type Variants } from "motion/react";

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

// Stylized equity curve — illustrative, not real data. Volatile but up-and-right.
const EQUITY_PATH =
  "M0,104 L38,96 L72,101 L104,78 L140,86 L176,58 L212,66 L250,40 L292,48 L336,22 L380,29 L420,10";
const EQUITY_AREA = `${EQUITY_PATH} L420,120 L0,120 Z`;

export function AuthBrandPanel() {
  const reduce = useReducedMotion();

  const container: Variants = {
    hidden: {},
    show: { transition: { staggerChildren: reduce ? 0 : 0.09, delayChildren: reduce ? 0 : 0.1 } },
  };
  const item: Variants = {
    hidden: reduce ? { opacity: 0 } : { opacity: 0, y: 14 },
    show: {
      opacity: 1,
      y: 0,
      transition: { duration: 0.6, ease: [0.16, 1, 0.3, 1] },
    },
  };

  return (
    <div className="relative hidden overflow-hidden lg:flex lg:flex-col lg:justify-between lg:p-12 xl:p-16">
      {/* Deep brand base */}
      <div className="bg-brand-gradient absolute inset-0 -z-30 opacity-95" />
      <div className="absolute inset-0 -z-30 bg-gradient-to-t from-black/45 via-transparent to-black/25" />

      {/* Drifting aurora orbs */}
      <div
        aria-hidden
        className="aurora-orb -top-28 -right-24 size-[26rem] opacity-45"
        style={{ background: "radial-gradient(circle, #ffffff, transparent 70%)" }}
      />
      <div
        aria-hidden
        className="aurora-orb -bottom-32 -left-20 size-[24rem] opacity-30"
        style={{
          background: "radial-gradient(circle, var(--brand-to), transparent 70%)",
          animationDelay: "-8s",
        }}
      />

      {/* Blueprint grid */}
      <div aria-hidden className="grid-fade absolute inset-0 -z-20 text-white/15" />

      {/* Animated equity-curve motif, anchored low */}
      <svg
        aria-hidden
        viewBox="0 0 420 120"
        preserveAspectRatio="none"
        className="absolute inset-x-0 bottom-0 -z-10 h-2/5 w-full text-white"
      >
        <defs>
          <linearGradient id="auth-eq-area" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="currentColor" stopOpacity="0.28" />
            <stop offset="100%" stopColor="currentColor" stopOpacity="0" />
          </linearGradient>
        </defs>
        <motion.path
          d={EQUITY_AREA}
          fill="url(#auth-eq-area)"
          initial={reduce ? false : { opacity: 0 }}
          animate={reduce ? undefined : { opacity: 1 }}
          transition={{ duration: 1.2, delay: 0.6 }}
        />
        <motion.path
          d={EQUITY_PATH}
          fill="none"
          stroke="currentColor"
          strokeWidth={2}
          strokeLinecap="round"
          strokeLinejoin="round"
          className="opacity-90"
          initial={reduce ? false : { pathLength: 0 }}
          animate={reduce ? undefined : { pathLength: 1 }}
          transition={{ duration: 2, ease: [0.16, 1, 0.3, 1], delay: 0.3 }}
        />
        <motion.circle
          cx={420}
          cy={10}
          r={4}
          className="animate-pulse-glow fill-white"
          initial={reduce ? false : { scale: 0, opacity: 0 }}
          animate={reduce ? undefined : { scale: 1, opacity: 1 }}
          transition={{ duration: 0.4, delay: 2.2 }}
        />
      </svg>

      {/* Foreground content */}
      <motion.div
        variants={container}
        initial="hidden"
        animate="show"
        className="contents"
      >
        <motion.div variants={item} className="flex items-center gap-2.5 text-white">
          <div className="flex size-9 items-center justify-center rounded-xl bg-white/15 ring-1 ring-white/25 backdrop-blur">
            <CandlestickChart className="size-5" />
          </div>
          <span className="text-lg font-semibold tracking-tight">Trading Hub</span>
        </motion.div>

        <div className="max-w-md text-white">
          <motion.div
            variants={item}
            className="mb-4 inline-flex items-center gap-1.5 rounded-full bg-white/15 px-3 py-1 text-xs font-medium ring-1 ring-white/20 backdrop-blur"
          >
            <Sparkles className="size-3.5" />
            Your private trading desk
          </motion.div>
          <motion.h1
            variants={item}
            className="text-4xl font-semibold leading-[1.1] tracking-tight text-balance xl:text-5xl"
          >
            Trade with a clear head and a clean record.
          </motion.h1>
          <motion.p variants={item} className="mt-4 text-base text-white/80">
            Plan, journal, and analyze every trade in one focused, beautifully quiet workspace.
          </motion.p>

          <motion.ul variants={container} className="mt-10 space-y-5">
            {HIGHLIGHTS.map((h) => (
              <motion.li key={h.title} variants={item} className="flex gap-3.5">
                <div className="mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-lg bg-white/15 ring-1 ring-white/20 backdrop-blur">
                  <h.icon className="size-4.5" />
                </div>
                <div>
                  <p className="font-medium">{h.title}</p>
                  <p className="text-sm text-white/70">{h.description}</p>
                </div>
              </motion.li>
            ))}
          </motion.ul>
        </div>

        <motion.p variants={item} className="text-sm text-white/60">
          Built for traders who take the process seriously.
        </motion.p>
      </motion.div>
    </div>
  );
}
