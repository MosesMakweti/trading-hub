"use client";

import { cn } from "@/lib/utils";
import type { EnvironmentId } from "@/domain/mindset/options";

/** Colour tokens per environment, shared by every Mindset surface. */
export const ENV_THEME: Record<EnvironmentId, { text: string; muted: string; accent: string; accentSoft: string; ring: string; panel: string; button: string }> = {
  NATURE: {
    text: "text-[#e9f0e6]",
    muted: "text-[#a9bba6]",
    accent: "text-[#a6cf9f]",
    accentSoft: "bg-[#a6cf9f]/15",
    ring: "border-[#a6cf9f]/40",
    panel: "bg-[#0d1a12]/55 border-[#a6cf9f]/15",
    button: "bg-[#a6cf9f]/15 hover:bg-[#a6cf9f]/25 text-[#e9f0e6] border-[#a6cf9f]/30",
  },
  FOCUS: {
    text: "text-[#e6eef8]",
    muted: "text-[#9fb0c8]",
    accent: "text-[#86cbd6]",
    accentSoft: "bg-[#86cbd6]/15",
    ring: "border-[#86cbd6]/40",
    panel: "bg-[#0a1428]/55 border-[#86cbd6]/15",
    button: "bg-[#86cbd6]/12 hover:bg-[#86cbd6]/22 text-[#e6eef8] border-[#86cbd6]/30",
  },
};

/** Layered pine silhouettes — a quiet forest edge along the bottom. */
function ForestEdge() {
  const ridge = (seed: number, height: number, count: number) => {
    let d = "M0 100 ";
    for (let i = 0; i <= count; i++) {
      const x = (i / count) * 100;
      const h = height * (0.6 + 0.4 * Math.abs(Math.sin(seed + i * 1.7)));
      d += `L${(x - 50 / count).toFixed(2)} ${(100 - h * 0.35).toFixed(2)} L${x.toFixed(2)} ${(100 - h).toFixed(2)} L${(x + 50 / count).toFixed(2)} ${(100 - h * 0.35).toFixed(2)} `;
    }
    return `${d}L100 100 Z`;
  };
  return (
    <svg className="absolute inset-x-0 bottom-0 h-[38%] w-full" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden>
      <path d={ridge(1, 55, 22)} fill="#0f2418" opacity="0.55" />
      <path d={ridge(4, 42, 30)} fill="#0b1c12" opacity="0.8" />
      <path d={ridge(9, 30, 40)} fill="#07130c" />
    </svg>
  );
}

/**
 * The full-bleed environment behind a Mindset surface. Nature: dark forest,
 * soft green light, slow mist. Focus: deep navy, muted teal glow, a quiet
 * horizon. Motion is a single slow drift (none for reduced-motion users).
 */
export function EnvironmentBackdrop({ environment, className, children }: { environment: EnvironmentId; className?: string; children?: React.ReactNode }) {
  return (
    <div className={cn("relative isolate overflow-hidden", className)}>
      {environment === "NATURE" ? (
        <div className="absolute inset-0 -z-10" aria-hidden>
          <div className="absolute inset-0 bg-[radial-gradient(120%_90%_at_50%_10%,#1d3a26_0%,#0c1c12_45%,#050c08_100%)]" />
          <div className="absolute inset-0 bg-[linear-gradient(115deg,rgba(214,234,190,0.10)_0%,transparent_35%)]" />
          <div className="mindset-drift absolute -inset-[10%] bg-[radial-gradient(45%_30%_at_30%_65%,rgba(170,205,170,0.16),transparent_70%)] blur-2xl" />
          <div className="mindset-drift-slow absolute -inset-[10%] bg-[radial-gradient(40%_25%_at_70%_55%,rgba(150,190,160,0.12),transparent_70%)] blur-2xl" />
          <ForestEdge />
          <div className="absolute inset-x-0 bottom-0 h-1/3 bg-gradient-to-t from-[#050c08]/80 to-transparent" />
        </div>
      ) : (
        <div className="absolute inset-0 -z-10" aria-hidden>
          <div className="absolute inset-0 bg-[radial-gradient(110%_80%_at_50%_0%,#13284a_0%,#0a1630_45%,#050a18_100%)]" />
          <div className="mindset-drift absolute -inset-[10%] bg-[radial-gradient(35%_30%_at_50%_45%,rgba(110,190,205,0.14),transparent_70%)] blur-3xl" />
          <div className="mindset-drift-slow absolute -inset-[10%] bg-[radial-gradient(30%_25%_at_25%_70%,rgba(90,130,200,0.10),transparent_70%)] blur-3xl" />
          <div className="absolute inset-x-0 top-[68%] h-px bg-gradient-to-r from-transparent via-[#86cbd6]/25 to-transparent" />
          <div className="absolute inset-x-0 bottom-0 h-1/3 bg-gradient-to-t from-[#050a18]/80 to-transparent" />
        </div>
      )}
      {children}
    </div>
  );
}
