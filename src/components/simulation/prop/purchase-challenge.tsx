"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import { purchaseChallengeAction } from "@/actions/simulation-prop.actions";
import type { FirmModel } from "@/domain/simulation/firm-model";
import { fmtMoney, fmtWallClock } from "../format";

interface ModelOption {
  id: string;
  source: "TEMPLATE" | "CUSTOM";
  version: number;
  model: FirmModel;
}
interface DatasetOption {
  id: string;
  symbol: string;
  firstBar: string | null;
  lastBar: string | null;
}

type Loss = FirmModel["phases"][number]["dailyLoss"];
type Max = FirmModel["phases"][number]["maxLoss"];
const ref = { INITIAL_BALANCE: "of the starting balance, from the day's start", DAY_START_BALANCE: "of the day's starting balance", DAY_START_HIGHER: "of the higher of the day's starting balance and equity" };
const dl = (d: Loss) => (d ? `Daily loss ${d.limitPercent}% ${ref[d.reference]} (${d.basis === "EQUITY" ? "equity, incl. floating" : "closed balance"})` : null);
const ml = (m: Max) =>
  m ? `Maximum loss ${m.limitPercent}% — ${{ STATIC: "static from the start", EOD_TRAILING: "trailing the highest end-of-day value", INTRADAY_TRAILING: "trailing the highest value at any minute" }[m.model]}${m.trailingLockAtStart ? ", stops at the starting balance" : ""} (${m.basis === "EQUITY" ? "equity" : "balance"})` : null;

/** Every rule of a stage, in plain words. */
function stageLines(m: FirmModel, i: number): string[] {
  if (i < m.phases.length) {
    const p = m.phases[i];
    return [
      `Profit target ${p.profitTargetPercent}%`,
      p.minTradingDays ? `At least ${p.minTradingDays} trading days` : null,
      p.maxCalendarDays ? `Within ${p.maxCalendarDays} calendar days` : "No time limit",
      p.consistencyMaxDayPercent ? `Best day at most ${p.consistencyMaxDayPercent}% of profit` : null,
      dl(p.dailyLoss),
      ml(p.maxLoss),
      !p.holding.allowOvernight ? "No positions through the daily reset" : !p.holding.allowWeekend ? "No positions over the weekend" : null,
      p.limits.maxQuantityPerPosition ? `Max ${p.limits.maxQuantityPerPosition} lots per position` : null,
    ].filter((x): x is string => !!x);
  }
  const f = m.funded;
  return [
    dl(f.dailyLoss),
    ml(f.maxLoss),
    `${f.payout.profitSplitPercent}% profit split; first payout after ${f.payout.firstPayoutAfterDays} days, then every ${f.payout.cycleDays}`,
    f.payout.minPayoutAmount ? `Minimum payout ${fmtMoney(f.payout.minPayoutAmount, m.currency)}` : null,
    f.payout.maxPayoutAmount ? `Maximum payout ${fmtMoney(f.payout.maxPayoutAmount, m.currency)}` : null,
    f.payout.profitBufferPercent ? `${f.payout.profitBufferPercent}% profit buffer stays in the account` : null,
    f.consistencyMaxDayPercent ? `Best day at most ${f.consistencyMaxDayPercent}% of profit` : null,
    !f.holding.allowOvernight ? "No positions through the daily reset" : !f.holding.allowWeekend ? "No positions over the weekend" : null,
  ].filter((x): x is string => !!x);
}

export function PurchaseChallenge({ models, datasets }: { models: ModelOption[]; datasets: DatasetOption[] }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [modelId, setModelId] = useState(models[0]?.id ?? "");
  const selected = models.find((m) => m.id === modelId);
  const [size, setSize] = useState<number | null>(selected?.model.sizes[0]?.accountSize ?? null);
  const [picked, setPicked] = useState<string[]>([]);
  const [periodStart, setPeriodStart] = useState("");
  const [periodEnd, setPeriodEnd] = useState("");
  const fee = selected?.model.sizes.find((s) => s.accountSize === size)?.fee;
  const instruments = selected?.model.instruments ?? null;
  const allowed = datasets.filter((d) => !instruments || instruments.includes(d.symbol));

  const choose = (id: string) => {
    setModelId(id);
    setSize(models.find((m) => m.id === id)?.model.sizes[0]?.accountSize ?? null);
  };
  const toggle = (d: DatasetOption) => {
    setPicked((prev) => (prev.includes(d.id) ? prev.filter((x) => x !== d.id) : [...prev.filter((x) => datasets.find((o) => o.id === x)?.symbol !== d.symbol), d.id]));
    if (!periodStart && d.firstBar) setPeriodStart(d.firstBar.slice(0, 10));
    if (!periodEnd && d.lastBar) setPeriodEnd(d.lastBar.slice(0, 10));
  };
  const buy = () =>
    start(async () => {
      const res = await purchaseChallengeAction({
        modelRef: modelId,
        accountSize: size,
        datasets: picked.map((id) => ({ assetSymbol: datasets.find((d) => d.id === id)!.symbol, datasetId: id })),
        periodStart,
        periodEnd,
      });
      if (!res.success) return void toast.error(res.error);
      toast.success("Challenge started");
      router.push(`/backtesting/terminal/${res.accountId}`);
    });

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
      <section aria-label="Firm models" className="space-y-2">
        <div className="flex items-baseline justify-between">
          <h2 className="text-sm font-medium">1 · Firm model</h2>
          <Link href="/backtesting/prop/models/new" className="text-xs text-primary underline-offset-4 hover:underline">Build a custom model</Link>
        </div>
        <ul className="space-y-2">
          {models.map((m) => (
            <li key={m.id}>
              <button type="button" aria-pressed={m.id === modelId} onClick={() => choose(m.id)} className={cn("w-full rounded-xl border p-3 text-left transition-colors", m.id === modelId ? "border-primary/60 bg-primary/5" : "border-border hover:bg-muted/40")}>
                <div className="flex items-center justify-between gap-2">
                  <span className="font-medium">{m.model.firmName} · {m.model.modelName}</span>
                  <span className="text-[10px] uppercase tracking-wider text-muted-foreground">{m.source === "TEMPLATE" ? "Generic template" : `Custom v${m.version}`}</span>
                </div>
                {m.model.description && <p className="mt-1 text-xs text-muted-foreground">{m.model.description}</p>}
                <p className="mt-1 font-mono text-[11px] text-muted-foreground tabular-nums">{m.model.phases.length === 0 ? "Instant funding" : `${m.model.phases.length} phase${m.model.phases.length === 1 ? "" : "s"}`} · {m.model.sizes.map((s) => fmtMoney(s.accountSize, m.model.currency).replace(".00", "")).join(" / ")}</p>
              </button>
            </li>
          ))}
        </ul>
      </section>

      {selected && (
        <section aria-label="Review and start" className="space-y-5 rounded-xl border border-border bg-card p-4">
          <div className="space-y-2">
            <h2 className="text-sm font-medium">2 · Account size</h2>
            <div className="flex flex-wrap gap-2">
              {selected.model.sizes.map((s) => (
                <button key={s.accountSize} type="button" aria-pressed={size === s.accountSize} onClick={() => setSize(s.accountSize)} className={cn("rounded-md border px-3 py-1.5 text-sm", size === s.accountSize ? "border-primary/60 bg-primary/10" : "border-border hover:bg-muted/40")}>
                  {fmtMoney(s.accountSize, selected.model.currency).replace(".00", "")} <span className="text-xs text-muted-foreground">· fee {fmtMoney(s.fee, selected.model.currency)}</span>
                </button>
              ))}
            </div>
          </div>
          <div className="space-y-2">
            <h2 className="text-sm font-medium">3 · Rules</h2>
            {[...selected.model.phases.map((p) => p.name), "Funded"].map((name, i) => (
              <div key={name} className="rounded-md border border-border/70 p-2.5">
                <h3 className="text-xs font-medium">{name}</h3>
                <ul className="mt-1 space-y-0.5 text-xs text-muted-foreground">{stageLines(selected.model, i).map((l) => <li key={l}>· {l}</li>)}</ul>
              </div>
            ))}
            <p className="text-[11px] text-muted-foreground">
              Daily reset {String(selected.model.dailyResetHour).padStart(2, "0")}:00 server time · commission {fmtMoney(selected.model.costs.commissionPerUnitPerSide, selected.model.currency)} per lot per side
              {selected.model.newsTradingRestricted ? " · news restriction recorded but not enforced (no calendar data)" : ""}
            </p>
          </div>
          <div className="space-y-2">
            <h2 className="text-sm font-medium">4 · Market data and period</h2>
            {allowed.length === 0 ? (
              <p className="text-xs text-muted-foreground">No historical data this model can trade. <Link href="/backtesting/data" className="text-primary underline-offset-4 hover:underline">Import MT5 data</Link>.</p>
            ) : (
              <ul className="max-h-36 space-y-1 overflow-y-auto rounded-md border border-border p-1">
                {allowed.map((d) => (
                  <li key={d.id}>
                    <label className="flex cursor-pointer items-center gap-2 rounded px-2 py-1 text-sm hover:bg-muted/60">
                      <input type="checkbox" checked={picked.includes(d.id)} onChange={() => toggle(d)} />
                      <span className="font-medium">{d.symbol}</span>
                      <span className="ml-auto font-mono text-[11px] text-muted-foreground tabular-nums">{fmtWallClock(d.firstBar?.slice(0, 10))} → {fmtWallClock(d.lastBar?.slice(0, 10))}</span>
                    </label>
                  </li>
                ))}
              </ul>
            )}
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1"><Label htmlFor="pc-start">From</Label><Input id="pc-start" type="date" value={periodStart} onChange={(e) => setPeriodStart(e.target.value)} /></div>
              <div className="space-y-1"><Label htmlFor="pc-end">To</Label><Input id="pc-end" type="date" value={periodEnd} onChange={(e) => setPeriodEnd(e.target.value)} /></div>
            </div>
            <p className="text-[11px] text-muted-foreground">Every stage plays forward through this period; a passed phase continues on the history that follows.</p>
          </div>
          <Button className="w-full" disabled={pending || !size || picked.length === 0 || !periodStart || !periodEnd} onClick={buy}>
            Start challenge{fee != null ? ` · simulated fee ${fmtMoney(fee, selected.model.currency)}` : ""}
          </Button>
        </section>
      )}
    </div>
  );
}
