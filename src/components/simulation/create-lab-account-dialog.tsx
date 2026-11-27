"use client";

import { useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Plus } from "lucide-react";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { createLabAccountAction } from "@/actions/simulation.actions";
import { fmtWallClock } from "./format";

export interface DatasetOption {
  id: string;
  symbol: string;
  firstBar: string | null;
  lastBar: string | null;
}

export interface StrategyOption {
  id: string;
  name: string;
  version: number;
}

export interface ExperimentOption {
  id: string;
  name: string;
  label: string;
}

type StrategyMode = "NONE" | "EXISTING" | "REFINE" | "EXPERIMENT" | "BUILD";

const MODES: { value: StrategyMode; label: string; hint: string }[] = [
  { value: "EXISTING", label: "Test a strategy", hint: "Backtest a Strategy Lab strategy exactly as it is. Its rules are frozen into this session." },
  { value: "REFINE", label: "Refine a strategy", hint: "Start an isolated experiment from a strategy. Edits in the terminal never change the original until you save them back." },
  { value: "EXPERIMENT", label: "Continue an experiment", hint: "Test an experiment you already started." },
  { value: "BUILD", label: "Build a new strategy", hint: "Start from a blank strategy and develop it in the terminal while you study the chart." },
  { value: "NONE", label: "No strategy", hint: "Discretionary backtesting without a structured strategy." },
];

/**
 * Creates a Strategy Lab backtest account: instruments (each backed by one of
 * the trader's MT5 datasets), a historical period, a simulated balance and
 * trading costs. Costs are locked once the replay starts.
 */
export function CreateLabAccountDialog({
  datasets,
  strategies,
  experiments = [],
  trigger = "New backtest",
}: {
  datasets: DatasetOption[];
  strategies: StrategyOption[];
  experiments?: ExperimentOption[];
  trigger?: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [name, setName] = useState("");
  const [mode, setMode] = useState<StrategyMode>(strategies.length ? "EXISTING" : "NONE");
  const [strategyId, setStrategyId] = useState("");
  const [experimentId, setExperimentId] = useState("");
  const [newStrategyName, setNewStrategyName] = useState("");
  const [picked, setPicked] = useState<string[]>([]);
  const [periodStart, setPeriodStart] = useState("");
  const [periodEnd, setPeriodEnd] = useState("");
  const [balance, setBalance] = useState("10000");
  const [commission, setCommission] = useState("3.5");
  const [spread, setSpread] = useState("0");
  const [resetHour, setResetHour] = useState("0");

  // One dataset per symbol: picking another for the same symbol replaces it.
  const bySymbol = useMemo(() => new Map(picked.map((id) => [datasets.find((d) => d.id === id)?.symbol, id])), [picked, datasets]);
  const toggle = (d: DatasetOption) => {
    setPicked((prev) => {
      if (prev.includes(d.id)) return prev.filter((x) => x !== d.id);
      const withoutSymbol = prev.filter((x) => datasets.find((o) => o.id === x)?.symbol !== d.symbol);
      return [...withoutSymbol, d.id];
    });
    // Default the period to the first picked dataset's range.
    if (!periodStart && d.firstBar) setPeriodStart(d.firstBar.slice(0, 10));
    if (!periodEnd && d.lastBar) setPeriodEnd(d.lastBar.slice(0, 10));
  };

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    startTransition(async () => {
      const res = await createLabAccountAction({
        name,
        strategyMode: mode,
        strategyId: mode === "EXISTING" || mode === "REFINE" ? strategyId || null : null,
        experimentId: mode === "EXPERIMENT" ? experimentId || null : null,
        newStrategyName: mode === "BUILD" ? newStrategyName || null : null,
        datasets: picked.map((id) => ({ assetSymbol: datasets.find((d) => d.id === id)!.symbol, datasetId: id })),
        periodStart,
        periodEnd,
        startingBalance: balance,
        currency: "USD",
        commissionPerUnitPerSide: commission || 0,
        defaultSpreadPoints: spread || 0,
        dailyResetHour: resetHour || 0,
      });
      if (!res.success) return void toast.error(res.error);
      toast.success("Backtest account created");
      setOpen(false);
      router.push(`/backtesting/terminal/${res.id}`);
    });
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button className="gap-1.5" />}>
        <Plus className="size-4" /> {trigger}
      </DialogTrigger>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>New Strategy Lab backtest</DialogTitle>
          <DialogDescription>Trade a historical period bar by bar with a simulated account. Nothing here touches your live accounts.</DialogDescription>
        </DialogHeader>
        {datasets.length === 0 ? (
          <div className="space-y-3 text-sm">
            <p className="text-muted-foreground">You need historical market data first. Import an MT5 M1 export for each instrument you want to trade.</p>
            <Link href="/backtesting/data" className="font-medium text-primary underline-offset-4 hover:underline">Import historical data</Link>
          </div>
        ) : (
          <form onSubmit={submit} className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="lab-name">Name</Label>
              <Input id="lab-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="London breakout · Q1 2024" required maxLength={120} />
            </div>

            <fieldset className="space-y-2">
              <legend className="text-sm font-medium">Strategy</legend>
              <div role="radiogroup" aria-label="Strategy mode" className="grid grid-cols-2 gap-1.5 sm:grid-cols-3">
                {MODES.filter((m) => m.value !== "EXPERIMENT" || experiments.length > 0).map((m) => (
                  <button
                    key={m.value}
                    type="button"
                    role="radio"
                    aria-checked={mode === m.value}
                    onClick={() => setMode(m.value)}
                    disabled={(m.value === "EXISTING" || m.value === "REFINE") && strategies.length === 0}
                    className={cn(
                      "rounded-md border px-2 py-1.5 text-left text-xs transition-colors disabled:opacity-40",
                      mode === m.value ? "border-primary bg-primary/10 font-medium" : "border-border hover:bg-muted/60",
                    )}
                  >
                    {m.label}
                  </button>
                ))}
              </div>
              <p className="text-xs text-muted-foreground">{MODES.find((m) => m.value === mode)?.hint}</p>
              {(mode === "EXISTING" || mode === "REFINE") && (
                <select aria-label="Strategy" value={strategyId} onChange={(e) => setStrategyId(e.target.value)} required className="h-8 w-full rounded-md border border-border bg-background px-2 text-sm">
                  <option value="">Choose a strategy…</option>
                  {strategies.map((s) => <option key={s.id} value={s.id}>{s.name} · v{s.version}</option>)}
                </select>
              )}
              {mode === "EXPERIMENT" && (
                <select aria-label="Experiment" value={experimentId} onChange={(e) => setExperimentId(e.target.value)} required className="h-8 w-full rounded-md border border-border bg-background px-2 text-sm">
                  <option value="">Choose an experiment…</option>
                  {experiments.map((x) => <option key={x.id} value={x.id}>{x.name} ({x.label})</option>)}
                </select>
              )}
              {mode === "BUILD" && (
                <Input aria-label="New strategy name" value={newStrategyName} onChange={(e) => setNewStrategyName(e.target.value)} placeholder="New strategy name" maxLength={120} required />
              )}
            </fieldset>

            <fieldset className="space-y-1.5">
              <legend className="text-sm font-medium">Instruments</legend>
              <ul className="max-h-44 space-y-1 overflow-y-auto rounded-md border border-border p-1">
                {datasets.map((d) => {
                  const on = picked.includes(d.id);
                  const other = !on && bySymbol.has(d.symbol);
                  return (
                    <li key={d.id}>
                      <label className={cn("flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-sm hover:bg-muted/60", on && "bg-muted")}>
                        <input type="checkbox" checked={on} onChange={() => toggle(d)} />
                        <span className="font-medium">{d.symbol}</span>
                        <span className="ml-auto font-mono text-[11px] text-muted-foreground tabular-nums">{fmtWallClock(d.firstBar?.slice(0, 10))} → {fmtWallClock(d.lastBar?.slice(0, 10))}</span>
                        {other && <span className="text-[10px] text-muted-foreground">replaces</span>}
                      </label>
                    </li>
                  );
                })}
              </ul>
            </fieldset>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="lab-start">From</Label>
                <Input id="lab-start" type="date" value={periodStart} onChange={(e) => setPeriodStart(e.target.value)} required />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="lab-end">To</Label>
                <Input id="lab-end" type="date" value={periodEnd} onChange={(e) => setPeriodEnd(e.target.value)} required />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="lab-balance">Starting balance (USD)</Label>
                <Input id="lab-balance" inputMode="decimal" value={balance} onChange={(e) => setBalance(e.target.value)} required />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="lab-commission">Commission per lot per side</Label>
                <Input id="lab-commission" inputMode="decimal" value={commission} onChange={(e) => setCommission(e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="lab-spread">Spread when a bar has none (points)</Label>
                <Input id="lab-spread" inputMode="numeric" value={spread} onChange={(e) => setSpread(e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="lab-reset">Daily reset hour (server time)</Label>
                <Input id="lab-reset" type="number" min={0} max={23} value={resetHour} onChange={(e) => setResetHour(e.target.value)} />
              </div>
            </div>

            <DialogFooter>
              <Button type="submit" disabled={pending || picked.length === 0 || !name}>Create backtest</Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
