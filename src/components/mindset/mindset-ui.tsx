"use client";

import { cn } from "@/lib/utils";
import type { EnvironmentId } from "@/domain/mindset/options";
import { ENV_THEME } from "@/components/mindset/environment-backdrop";

/** Small themed building blocks for the Mindset surfaces (calm, low-contrast). */

export function Panel({ env, className, children, ...rest }: { env: EnvironmentId } & React.HTMLAttributes<HTMLElement>) {
  return (
    <section className={cn("rounded-2xl border p-4 backdrop-blur-md sm:p-5", ENV_THEME[env].panel, className)} {...rest}>
      {children}
    </section>
  );
}

export function PanelTitle({ env, children, hint }: { env: EnvironmentId; children: React.ReactNode; hint?: string }) {
  return (
    <div className="mb-3">
      <h2 className={cn("text-sm font-medium tracking-wide", ENV_THEME[env].text)}>{children}</h2>
      {hint && <p className={cn("mt-0.5 text-xs", ENV_THEME[env].muted)}>{hint}</p>}
    </div>
  );
}

export function Chip({ env, active, className, ...rest }: { env: EnvironmentId; active: boolean } & React.ButtonHTMLAttributes<HTMLButtonElement>) {
  const t = ENV_THEME[env];
  return (
    <button
      type="button"
      aria-pressed={active}
      className={cn(
        "rounded-full border px-3 py-1 text-xs transition-colors disabled:opacity-40",
        active ? cn(t.accentSoft, t.ring, t.text) : cn("border-white/10 hover:border-white/25", t.muted),
        className,
      )}
      {...rest}
    />
  );
}

export function Toggle({ env, checked, onChange, label }: { env: EnvironmentId; checked: boolean; onChange: (next: boolean) => void; label: string }) {
  const t = ENV_THEME[env];
  return (
    <button type="button" role="switch" aria-checked={checked} aria-label={label} onClick={() => onChange(!checked)} className="inline-flex items-center gap-2 text-xs">
      <span className={cn("relative h-5 w-9 rounded-full border transition-colors", checked ? cn(t.accentSoft, t.ring) : "border-white/15 bg-white/5")}>
        <span className={cn("absolute top-0.5 size-3.5 rounded-full transition-all", checked ? "left-[18px] bg-current" : "left-0.5 bg-white/40", checked && t.accent)} />
      </span>
      <span className={t.muted}>{label}</span>
    </button>
  );
}

export function FieldLabel({ env, children }: { env: EnvironmentId; children: React.ReactNode }) {
  return <p className={cn("mb-1.5 text-[11px] tracking-[0.18em] uppercase", ENV_THEME[env].muted)}>{children}</p>;
}
