"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Check, Loader2 } from "lucide-react";

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RichTextEditor } from "@/components/plan/rich-text-editor";
import { SimpleListSection } from "@/components/plan/simple-list-section";
import { PartialTpList } from "@/components/strategy-lab/partial-tp-list";
import { useDebouncedAutosave } from "@/hooks/use-debounced-autosave";
import { updateTradeManagement } from "@/actions/strategy-trade-management.actions";
import {
  archiveCustomRule,
  createCustomRule,
  reorderCustomRules,
  updateCustomRule,
} from "@/actions/strategy-trade-management.actions";
import type { TradeManagementRichField } from "@/lib/validation/strategy-trade-management";
import type { TradeManagementDTO } from "@/types/strategies";
import { MIN_EXPECTANCY_SAMPLE, type ExpectancyStats } from "@/domain/performance/expectancy";

const FIELDS: { key: TradeManagementRichField; label: string; placeholder: string }[] = [
  { key: "takeProfitPhilosophy", label: "Overall take-profit philosophy", placeholder: "How do you think about taking profit?" },
  { key: "initialStopPlacement", label: "Initial stop-loss placement", placeholder: "Where does the first stop go?" },
  { key: "breakEvenRules", label: "Break-even rules", placeholder: "When do you move to break-even?" },
  { key: "trailingStopRules", label: "Trailing-stop rules", placeholder: "How do you trail?" },
  { key: "scalingInRules", label: "Scaling-in rules", placeholder: "When do you add to a position?" },
  { key: "scalingOutRules", label: "Scaling-out rules", placeholder: "When do you reduce?" },
];

type RichFields = Record<TradeManagementRichField, unknown>;

export function TradeManagementSection({
  strategyId,
  tradeManagement,
  liveExpectancy,
}: {
  strategyId: string;
  tradeManagement: TradeManagementDTO;
  liveExpectancy: ExpectancyStats;
}) {
  const tm = tradeManagement;

  const [fields, setFields] = useState<RichFields>(() => ({
    takeProfitPhilosophy: tm.takeProfitPhilosophy,
    initialStopPlacement: tm.initialStopPlacement,
    breakEvenRules: tm.breakEvenRules,
    trailingStopRules: tm.trailingStopRules,
    scalingInRules: tm.scalingInRules,
    scalingOutRules: tm.scalingOutRules,
  }));
  const [limits, setLimits] = useState({
    maxHoldingTime: tm.maxHoldingTime ?? "",
    maxRiskPercent: tm.maxRiskPercent?.toString() ?? "",
  });
  const [benchmarks, setBenchmarks] = useState({
    expectedWinRate: tm.expectedWinRate?.toString() ?? "",
    expectedAvgRr: tm.expectedAvgRr?.toString() ?? "",
    expectedExpectancy: tm.expectedExpectancy?.toString() ?? "",
    minExecutionScore: tm.minExecutionScore?.toString() ?? "",
  });

  const limitsSave = useDebouncedAutosave({
    value: limits,
    serialize: (v) => JSON.stringify([v.maxHoldingTime.trim(), v.maxRiskPercent.trim()]),
    save: async (v) => {
      const pct = v.maxRiskPercent.trim();
      const num = pct === "" ? null : Number(pct);
      if (num !== null && (Number.isNaN(num) || num < 0 || num > 100)) {
        return { success: false, error: "Max risk must be 0–100%." };
      }
      return updateTradeManagement(strategyId, tm.id, {
        maxHoldingTime: v.maxHoldingTime.trim() === "" ? null : v.maxHoldingTime.trim(),
        maxRiskPercent: num,
      });
    },
    onError: (m) => {
      if (m) toast.error(m);
    },
  });

  // The strategy's proven edge — feeds the Discrepancy-Gap Execution Engine.
  const benchmarksSave = useDebouncedAutosave({
    value: benchmarks,
    serialize: (v) => JSON.stringify(v),
    save: async (v) => {
      const parse = (raw: string, min: number, max: number, integer = false) => {
        const t = raw.trim();
        if (t === "") return { ok: true as const, value: null };
        const n = Number(t);
        if (Number.isNaN(n) || n < min || n > max || (integer && !Number.isInteger(n))) {
          return { ok: false as const };
        }
        return { ok: true as const, value: n };
      };
      const wr = parse(v.expectedWinRate, 0, 100);
      const rr = parse(v.expectedAvgRr, -100, 100);
      const ex = parse(v.expectedExpectancy, -100, 100);
      const mes = parse(v.minExecutionScore, 0, 100, true);
      if (!wr.ok || !rr.ok || !ex.ok || !mes.ok) {
        return { success: false, error: "Check the benchmark values." };
      }
      return updateTradeManagement(strategyId, tm.id, {
        expectedWinRate: wr.value,
        expectedAvgRr: rr.value,
        expectedExpectancy: ex.value,
        minExecutionScore: mes.value,
      });
    },
    onError: (m) => {
      if (m) toast.error(m);
    },
  });

  function saveRich(key: TradeManagementRichField) {
    return async (content: object) => {
      setFields((f) => ({ ...f, [key]: content }));
      return updateTradeManagement(strategyId, tm.id, { [key]: content });
    };
  }

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        How you manage a position after entry.
      </p>

      {/* Core rules + limits */}
      <div className="glass space-y-5 rounded-2xl p-5">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          {FIELDS.map((f) => (
            <div key={f.key} className="space-y-1.5">
              <Label className="text-xs">{f.label}</Label>
              <RichTextEditor
                initialContent={fields[f.key]}
                placeholder={f.placeholder}
                onSave={saveRich(f.key)}
              />
            </div>
          ))}
        </div>

        <div className="grid grid-cols-1 gap-4 border-t border-border pt-4 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="tm-max-hold" className="text-xs">
              Maximum holding time
            </Label>
            <Input
              id="tm-max-hold"
              value={limits.maxHoldingTime}
              onChange={(e) => setLimits((l) => ({ ...l, maxHoldingTime: e.target.value }))}
              placeholder="e.g. 2 hours, 1 session"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="tm-max-risk" className="text-xs">
              Maximum risk (% per trade)
            </Label>
            <div className="flex items-center gap-2">
              <Input
                id="tm-max-risk"
                type="number"
                min={0}
                max={100}
                step="0.1"
                value={limits.maxRiskPercent}
                onChange={(e) => setLimits((l) => ({ ...l, maxRiskPercent: e.target.value }))}
                placeholder="e.g. 1"
                className="max-w-32"
              />
              <span className="text-sm text-muted-foreground">%</span>
              {limitsSave === "saving" && <Loader2 className="size-3.5 animate-spin text-muted-foreground" />}
              {limitsSave === "saved" && <Check className="size-3.5 text-success" />}
            </div>
          </div>
        </div>
      </div>

      {/* Discrepancy-Gap benchmarks — the strategy's proven edge */}
      <div className="glass space-y-4 rounded-2xl p-5">
        <div className="flex items-start justify-between gap-2">
          <div>
            <h3 className="text-sm font-medium">Expected performance (statistical benchmark)</h3>
            <p className="text-xs text-muted-foreground">
              Your strategy&apos;s statistical edge — the benchmark for the Expected Statistical
              Equity line. It is a per-trade average over a large sample, never the predicted result
              of the next trade. TradeOS uses your <strong>Live</strong> expectancy once the sample is
              large enough, and falls back to these <strong>Backtested</strong> numbers otherwise.
            </p>
          </div>
          <span className="w-5 shrink-0 pt-0.5">
            {benchmarksSave === "saving" && <Loader2 className="size-3.5 animate-spin text-muted-foreground" />}
            {benchmarksSave === "saved" && <Check className="size-3.5 text-success" />}
          </span>
        </div>

        <LivePerformance stats={liveExpectancy} backtestedExpectancy={tm.expectedExpectancy} />
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          <div className="space-y-1.5">
            <Label htmlFor="bm-wr" className="text-xs">Expected win rate</Label>
            <div className="flex items-center gap-1.5">
              <Input
                id="bm-wr"
                type="number"
                min={0}
                max={100}
                step="1"
                value={benchmarks.expectedWinRate}
                onChange={(e) => setBenchmarks((b) => ({ ...b, expectedWinRate: e.target.value }))}
                placeholder="55"
              />
              <span className="text-sm text-muted-foreground">%</span>
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="bm-rr" className="text-xs">Expected avg RR</Label>
            <div className="flex items-center gap-1.5">
              <Input
                id="bm-rr"
                type="number"
                step="0.1"
                value={benchmarks.expectedAvgRr}
                onChange={(e) => setBenchmarks((b) => ({ ...b, expectedAvgRr: e.target.value }))}
                placeholder="2.0"
              />
              <span className="text-sm text-muted-foreground">R</span>
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="bm-ex" className="text-xs">Expected expectancy</Label>
            <div className="flex items-center gap-1.5">
              <Input
                id="bm-ex"
                type="number"
                step="0.05"
                value={benchmarks.expectedExpectancy}
                onChange={(e) => setBenchmarks((b) => ({ ...b, expectedExpectancy: e.target.value }))}
                placeholder="1.5"
              />
              <span className="text-sm text-muted-foreground">R</span>
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="bm-mes" className="text-xs">Min execution score</Label>
            <div className="flex items-center gap-1.5">
              <Input
                id="bm-mes"
                type="number"
                min={0}
                max={100}
                step="1"
                value={benchmarks.minExecutionScore}
                onChange={(e) => setBenchmarks((b) => ({ ...b, minExecutionScore: e.target.value }))}
                placeholder="80"
              />
              <span className="text-sm text-muted-foreground">%</span>
            </div>
          </div>
        </div>
      </div>

      {/* Partial take-profit levels */}
      <div className="glass space-y-3 rounded-2xl p-5">
        <div>
          <h3 className="text-sm font-medium">Partial take-profit levels</h3>
          <p className="text-xs text-muted-foreground">
            Where you scale out — trigger, how much to close, and why.
          </p>
        </div>
        <PartialTpList
          strategyId={strategyId}
          tradeManagementId={tm.id}
          initialLevels={tm.partialTakeProfits}
        />
      </div>

      {/* Custom rules (reuses the plan SimpleListSection) */}
      <div className="glass space-y-3 rounded-2xl p-5">
        <div>
          <h3 className="text-sm font-medium">Custom rules</h3>
          <p className="text-xs text-muted-foreground">
            Your own management rules — e.g. &ldquo;Move stop to BE after 2R&rdquo;, &ldquo;Never add after news&rdquo;.
          </p>
        </div>
        <SimpleListSection
          initialItems={tm.customRules}
          fields={[{ key: "text", placeholder: "e.g. Trail below M5 swing lows" }]}
          actions={{
            create: (values) => createCustomRule(strategyId, tm.id, values),
            update: (id, values) => updateCustomRule(strategyId, id, values),
            archive: (id) => archiveCustomRule(strategyId, id),
            reorder: (orderedIds) => reorderCustomRules(strategyId, tm.id, orderedIds),
          }}
          emptyMessage="No custom rules yet."
          addLabel="Add rule"
          itemLabel="rule"
        />
      </div>
    </div>
  );
}

/** Live statistical performance computed from this strategy's own qualifying trades.
 *  Shows which source (Live vs Backtested) is currently driving the benchmark. */
function LivePerformance({
  stats,
  backtestedExpectancy,
}: {
  stats: ExpectancyStats;
  backtestedExpectancy: number | null;
}) {
  const usingLive = stats.sufficient && stats.expectancyR != null;
  const active = usingLive
    ? { label: "Live", className: "border-success/30 bg-success/10 text-success" }
    : backtestedExpectancy != null
      ? { label: "Backtested", className: "border-warning/30 bg-warning/10 text-warning" }
      : { label: "Insufficient sample", className: "border-border bg-muted/40 text-muted-foreground" };

  const R = (n: number | null) => (n == null ? "—" : `${n >= 0 ? "+" : ""}${n.toFixed(2)}R`);
  const PCT = (n: number | null) => (n == null ? "—" : `${n.toFixed(0)}%`);

  return (
    <div className="rounded-xl border border-border bg-background/40 p-3">
      <div className="mb-2 flex items-center justify-between gap-2">
        <span className="text-xs font-medium text-muted-foreground">
          Live performance
          <span className="ml-1.5 font-normal text-muted-foreground/60 tabular-nums">
            {stats.sampleSize} trade{stats.sampleSize === 1 ? "" : "s"}
          </span>
        </span>
        <span
          className={`inline-flex items-center rounded-full border px-1.5 py-0.5 text-[10px] font-semibold tracking-wide uppercase ${active.className}`}
        >
          {active.label} benchmark
        </span>
      </div>
      <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs sm:grid-cols-4">
        <LiveStat label="Win rate" value={PCT(stats.winRate)} />
        <LiveStat label="Avg winner" value={R(stats.avgWinR)} />
        <LiveStat label="Avg loser" value={R(stats.avgLossR)} />
        <LiveStat label="Expectancy" value={R(stats.expectancyR)} />
      </div>
      {!stats.sufficient && (
        <p className="mt-1.5 text-[11px] text-muted-foreground/70">
          Needs {MIN_EXPECTANCY_SAMPLE}+ trades for a reliable live expectancy — using the backtested
          number until then (no fabricated benchmark).
        </p>
      )}
    </div>
  );
}

function LiveStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-2 sm:flex-col sm:items-start sm:gap-0">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-semibold text-foreground tabular-nums">{value}</span>
    </div>
  );
}
