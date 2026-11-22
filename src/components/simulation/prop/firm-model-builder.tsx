"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { createFirmModelAction } from "@/actions/simulation-prop.actions";

type LossRef = "INITIAL_BALANCE" | "DAY_START_BALANCE" | "DAY_START_HIGHER";
type MaxModel = "STATIC" | "EOD_TRAILING" | "INTRADAY_TRAILING";
type Basis = "BALANCE" | "EQUITY";
interface LossForm {
  dailyPct: string;
  dailyRef: LossRef;
  dailyBasis: Basis;
  maxPct: string;
  maxModel: MaxModel;
  maxBasis: Basis;
  lock: boolean;
}
interface PhaseForm extends LossForm {
  name: string;
  target: string;
  minDays: string;
  maxDays: string;
  consistency: string;
}
const lossDefaults: LossForm = { dailyPct: "5", dailyRef: "INITIAL_BALANCE", dailyBasis: "EQUITY", maxPct: "10", maxModel: "STATIC", maxBasis: "EQUITY", lock: false };
const phaseDefaults = (i: number): PhaseForm => ({ ...lossDefaults, name: `Phase ${i + 1}`, target: i === 0 ? "8" : "5", minDays: "4", maxDays: "", consistency: "" });
const num = (v: string) => (v.trim() === "" ? null : Number(v));

function lossOf(f: LossForm) {
  return {
    dailyLoss: num(f.dailyPct) == null ? null : { limitPercent: num(f.dailyPct)!, reference: f.dailyRef, basis: f.dailyBasis },
    maxLoss: num(f.maxPct) == null ? null : { limitPercent: num(f.maxPct)!, model: f.maxModel, basis: f.maxBasis, trailingLockAtStart: f.lock },
  };
}

const sel = "h-8 rounded-md border border-border bg-background px-2 text-sm";

function LossFields({ value, onChange, idPrefix }: { value: LossForm; onChange: (v: LossForm) => void; idPrefix: string }) {
  const set = <K extends keyof LossForm>(k: K, v: LossForm[K]) => onChange({ ...value, [k]: v });
  return (
    <div className="grid gap-2 sm:grid-cols-2">
      <fieldset className="space-y-1.5">
        <legend className="text-xs font-medium">Daily loss <span className="font-normal text-muted-foreground">(blank = none)</span></legend>
        <div className="flex flex-wrap items-center gap-1.5">
          <Input aria-label="Daily loss %" id={`${idPrefix}-dl`} value={value.dailyPct} onChange={(e) => set("dailyPct", e.target.value)} className="h-8 w-16" inputMode="decimal" />
          <span className="text-xs">%</span>
          <select aria-label="Daily loss measured from" value={value.dailyRef} onChange={(e) => set("dailyRef", e.target.value as LossRef)} className={sel}>
            <option value="INITIAL_BALANCE">of start, from day start</option>
            <option value="DAY_START_BALANCE">of day-start balance</option>
            <option value="DAY_START_HIGHER">of higher day-start bal/eq</option>
          </select>
          <select aria-label="Daily loss basis" value={value.dailyBasis} onChange={(e) => set("dailyBasis", e.target.value as Basis)} className={sel}>
            <option value="EQUITY">equity</option>
            <option value="BALANCE">balance</option>
          </select>
        </div>
      </fieldset>
      <fieldset className="space-y-1.5">
        <legend className="text-xs font-medium">Maximum loss <span className="font-normal text-muted-foreground">(blank = none)</span></legend>
        <div className="flex flex-wrap items-center gap-1.5">
          <Input aria-label="Maximum loss %" value={value.maxPct} onChange={(e) => set("maxPct", e.target.value)} className="h-8 w-16" inputMode="decimal" />
          <span className="text-xs">%</span>
          <select aria-label="Drawdown model" value={value.maxModel} onChange={(e) => set("maxModel", e.target.value as MaxModel)} className={sel}>
            <option value="STATIC">static</option>
            <option value="EOD_TRAILING">end-of-day trailing</option>
            <option value="INTRADAY_TRAILING">intraday trailing</option>
          </select>
          <select aria-label="Maximum loss basis" value={value.maxBasis} onChange={(e) => set("maxBasis", e.target.value as Basis)} className={sel}>
            <option value="EQUITY">equity</option>
            <option value="BALANCE">balance</option>
          </select>
          {value.maxModel !== "STATIC" && (
            <label className="flex items-center gap-1 text-xs"><input type="checkbox" checked={value.lock} onChange={(e) => set("lock", e.target.checked)} /> stops at start</label>
          )}
        </div>
      </fieldset>
    </div>
  );
}

/** Builds a custom, versioned firm model. Validation happens on the server with the domain schema. */
export function FirmModelBuilder() {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [firmName, setFirmName] = useState("");
  const [modelName, setModelName] = useState("");
  const [description, setDescription] = useState("");
  const [sizes, setSizes] = useState("25000:199, 50000:299");
  const [resetHour, setResetHour] = useState("0");
  const [commission, setCommission] = useState("3.5");
  const [overnight, setOvernight] = useState(true);
  const [weekend, setWeekend] = useState(true);
  const [phases, setPhases] = useState<PhaseForm[]>([phaseDefaults(0), phaseDefaults(1)]);
  const [funded, setFunded] = useState<LossForm>(lossDefaults);
  const [payout, setPayout] = useState({ split: "80", first: "14", cycle: "14", min: "100", max: "", buffer: "0" });

  const setPhase = (i: number, v: Partial<PhaseForm>) => setPhases((ps) => ps.map((p, j) => (j === i ? { ...p, ...v } : p)));

  const save = (e: React.FormEvent) => {
    e.preventDefault();
    const sizeList = sizes.split(",").map((s) => s.split(":").map((x) => Number(x.trim()))).filter(([a, f]) => a > 0 && f >= 0).map(([accountSize, fee]) => ({ accountSize, fee }));
    const holding = { allowOvernight: overnight, allowWeekend: weekend };
    start(async () => {
      const res = await createFirmModelAction({
        firmName,
        modelName,
        description: description || null,
        challengeType: phases.length === 0 ? "INSTANT" : (["ONE_STEP", "TWO_STEP", "THREE_STEP"] as const)[phases.length - 1],
        sizes: sizeList,
        dailyResetHour: Number(resetHour) || 0,
        costs: { commissionPerUnitPerSide: Number(commission) || 0 },
        phases: phases.map((p) => ({
          name: p.name,
          profitTargetPercent: Number(p.target),
          minTradingDays: num(p.minDays),
          maxCalendarDays: num(p.maxDays),
          consistencyMaxDayPercent: num(p.consistency),
          ...lossOf(p),
          holding,
        })),
        funded: {
          ...lossOf(funded),
          holding,
          payout: {
            profitSplitPercent: Number(payout.split),
            firstPayoutAfterDays: Number(payout.first),
            cycleDays: Number(payout.cycle),
            minPayoutAmount: Number(payout.min) || 0,
            maxPayoutAmount: num(payout.max),
            profitBufferPercent: Number(payout.buffer) || 0,
          },
        },
      });
      if (!res.success) return void toast.error(res.error);
      toast.success("Model saved");
      router.push("/backtesting/prop/new");
    });
  };

  return (
    <form onSubmit={save} className="space-y-6">
      <section className="grid gap-3 rounded-xl border border-border bg-card p-4 sm:grid-cols-2">
        <div className="space-y-1"><Label htmlFor="fm-firm">Firm name</Label><Input id="fm-firm" value={firmName} onChange={(e) => setFirmName(e.target.value)} required maxLength={80} placeholder="My prop model" /></div>
        <div className="space-y-1"><Label htmlFor="fm-model">Model name</Label><Input id="fm-model" value={modelName} onChange={(e) => setModelName(e.target.value)} required maxLength={80} placeholder="Two-step 25k" /></div>
        <div className="space-y-1 sm:col-span-2"><Label htmlFor="fm-desc">Description</Label><Input id="fm-desc" value={description} onChange={(e) => setDescription(e.target.value)} maxLength={2000} /></div>
        <div className="space-y-1"><Label htmlFor="fm-sizes">Sizes and fees</Label><Input id="fm-sizes" value={sizes} onChange={(e) => setSizes(e.target.value)} placeholder="25000:199, 50000:299" /><p className="text-[11px] text-muted-foreground">size:fee, comma-separated</p></div>
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1"><Label htmlFor="fm-reset">Daily reset (server hour)</Label><Input id="fm-reset" type="number" min={0} max={23} value={resetHour} onChange={(e) => setResetHour(e.target.value)} /></div>
          <div className="space-y-1"><Label htmlFor="fm-comm">Commission / lot / side</Label><Input id="fm-comm" inputMode="decimal" value={commission} onChange={(e) => setCommission(e.target.value)} /></div>
        </div>
        <div className="flex gap-4 text-sm sm:col-span-2">
          <label className="flex items-center gap-1.5"><input type="checkbox" checked={overnight} onChange={(e) => setOvernight(e.target.checked)} /> Overnight holding allowed</label>
          <label className="flex items-center gap-1.5"><input type="checkbox" checked={weekend} onChange={(e) => setWeekend(e.target.checked)} /> Weekend holding allowed</label>
        </div>
      </section>

      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-medium">Evaluation phases <span className="font-normal text-muted-foreground">({phases.length === 0 ? "instant funding" : phases.length})</span></h2>
          <div className="flex gap-2">
            <Button type="button" size="sm" variant="outline" disabled={phases.length >= 3} onClick={() => setPhases((p) => [...p, phaseDefaults(p.length)])}>Add phase</Button>
            <Button type="button" size="sm" variant="ghost" disabled={phases.length === 0} onClick={() => setPhases((p) => p.slice(0, -1))}>Remove last</Button>
          </div>
        </div>
        {phases.map((p, i) => (
          <div key={i} className="space-y-3 rounded-xl border border-border bg-card p-4">
            <div className="grid gap-2 sm:grid-cols-5">
              <div className="space-y-1"><Label>Name</Label><Input value={p.name} onChange={(e) => setPhase(i, { name: e.target.value })} /></div>
              <div className="space-y-1"><Label>Target %</Label><Input inputMode="decimal" value={p.target} onChange={(e) => setPhase(i, { target: e.target.value })} required /></div>
              <div className="space-y-1"><Label>Min trading days</Label><Input inputMode="numeric" value={p.minDays} onChange={(e) => setPhase(i, { minDays: e.target.value })} /></div>
              <div className="space-y-1"><Label>Max calendar days</Label><Input inputMode="numeric" value={p.maxDays} onChange={(e) => setPhase(i, { maxDays: e.target.value })} placeholder="none" /></div>
              <div className="space-y-1"><Label>Consistency %</Label><Input inputMode="decimal" value={p.consistency} onChange={(e) => setPhase(i, { consistency: e.target.value })} placeholder="none" /></div>
            </div>
            <LossFields idPrefix={`p${i}`} value={p} onChange={(v) => setPhase(i, v)} />
          </div>
        ))}
      </section>

      <section className="space-y-3 rounded-xl border border-border bg-card p-4">
        <h2 className="text-sm font-medium">Funded account</h2>
        <LossFields idPrefix="funded" value={funded} onChange={setFunded} />
        <div className="grid gap-2 sm:grid-cols-6">
          <div className="space-y-1"><Label>Profit split %</Label><Input inputMode="decimal" value={payout.split} onChange={(e) => setPayout({ ...payout, split: e.target.value })} required /></div>
          <div className="space-y-1"><Label>First payout (days)</Label><Input inputMode="numeric" value={payout.first} onChange={(e) => setPayout({ ...payout, first: e.target.value })} /></div>
          <div className="space-y-1"><Label>Cycle (days)</Label><Input inputMode="numeric" value={payout.cycle} onChange={(e) => setPayout({ ...payout, cycle: e.target.value })} /></div>
          <div className="space-y-1"><Label>Min payout</Label><Input inputMode="decimal" value={payout.min} onChange={(e) => setPayout({ ...payout, min: e.target.value })} /></div>
          <div className="space-y-1"><Label>Max payout</Label><Input inputMode="decimal" value={payout.max} onChange={(e) => setPayout({ ...payout, max: e.target.value })} placeholder="none" /></div>
          <div className="space-y-1"><Label>Profit buffer %</Label><Input inputMode="decimal" value={payout.buffer} onChange={(e) => setPayout({ ...payout, buffer: e.target.value })} /></div>
        </div>
      </section>

      <Button type="submit" disabled={pending || !firmName || !modelName}>Save model</Button>
    </form>
  );
}
