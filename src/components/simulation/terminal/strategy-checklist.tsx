"use client";

import { useMemo } from "react";
import { ChevronDown, ClipboardCheck } from "lucide-react";

import { cn } from "@/lib/utils";
import { evaluateStrategyDecision, evaluationCandidates } from "@/domain/strategies/strategy-evaluation";
import type { StrategyVersionSnapshot } from "@/types/strategies";

export interface StrategyCheckState {
  setupTypeName: string | null;
  checked: string[];
}

/**
 * The trader's strategy checklist on the order ticket. The trader confirms
 * which conditions are present on the chart; the score preview uses the same
 * pure evaluator the server runs. The server re-evaluates authoritatively on
 * placement (adding session / trades-per-day / risk checks at the replay
 * clock) and freezes the result on the order and position.
 */
export function StrategyChecklist({
  snapshot,
  side,
  value,
  onChange,
}: {
  snapshot: StrategyVersionSnapshot;
  side: "BUY" | "SELL";
  value: StrategyCheckState;
  onChange: (next: StrategyCheckState) => void;
}) {
  const direction = side === "BUY" ? "LONG" : "SHORT";
  const setupTypes = snapshot.setupTypes ?? [];
  const candidates = useMemo(() => evaluationCandidates(snapshot, direction, value.setupTypeName), [snapshot, direction, value.setupTypeName]);
  const preview = useMemo(
    () =>
      evaluateStrategyDecision({
        snapshot,
        direction,
        setupTypeName: value.setupTypeName,
        checkedNames: value.checked,
        context: { localMinuteOfDay: null, timezoneLabel: "", tradesTodayBefore: 0, riskPercent: null, dayRiskPercentBefore: 0 },
      }),
    [snapshot, direction, value],
  );
  const eligible = (d?: string | null) => !d || d === "BOTH" || (direction === "LONG" ? d === "BULLISH" : d === "BEARISH");
  const items = [
    ...candidates.confluences.filter((c) => eligible(c.directionApplicability)).map((c) => ({ ...c, group: "Confluence" })),
    ...candidates.execution.map((c) => ({ ...c, group: "Execution" })),
  ];
  const toggle = (name: string) =>
    onChange({ ...value, checked: value.checked.includes(name) ? value.checked.filter((x) => x !== name) : [...value.checked, name] });

  return (
    <details className="group rounded-md border border-border" open>
      <summary className="flex cursor-pointer list-none items-center gap-1.5 px-2 py-1.5 text-xs font-medium">
        <ClipboardCheck className="size-3.5" /> Strategy checklist
        {preview.score != null && (
          <span className="ml-auto tabular-nums text-muted-foreground">
            {preview.score}
            {preview.rating ? ` · ${preview.rating}` : ""}
          </span>
        )}
        <ChevronDown className={cn("size-3.5 transition-transform group-open:rotate-180", preview.score == null && "ml-auto")} />
      </summary>
      <div className="space-y-2 border-t border-border px-2 py-2 text-xs">
        {setupTypes.length > 0 && (
          <select
            aria-label="Setup type"
            value={value.setupTypeName ?? ""}
            onChange={(e) => onChange({ setupTypeName: e.target.value || null, checked: [] })}
            className="h-7 w-full rounded-md border border-border bg-background px-1.5"
          >
            <option value="">No setup type (all confluences)</option>
            {setupTypes.map((t) => (
              <option key={t.name} value={t.name}>
                {t.name}
              </option>
            ))}
          </select>
        )}
        {value.setupTypeName && !candidates.scenario && <p className="text-amber-500">This setup type has no {direction === "LONG" ? "long" : "short"} scenario.</p>}
        {items.length === 0 ? (
          <p className="text-muted-foreground">No conditions to confirm for a {direction === "LONG" ? "long" : "short"} trade.</p>
        ) : (
          <ul className="space-y-1">
            {items.map((c) => (
              <li key={`${c.group}-${c.id}`}>
                <label className="flex cursor-pointer items-center gap-2">
                  <input type="checkbox" className="size-3.5" checked={value.checked.includes(c.name)} onChange={() => toggle(c.name)} />
                  <span className="min-w-0 flex-1 truncate">{c.name}</span>
                  {c.mandatory && <span className="text-[10px] text-amber-500">required</span>}
                  {c.weight != null && <span className="tabular-nums text-muted-foreground">w{c.weight}</span>}
                </label>
              </li>
            ))}
          </ul>
        )}
        {preview.missingMandatory.length > 0 && <p className="text-amber-500">Missing required: {preview.missingMandatory.join(", ")}</p>}
        <p className="text-[11px] text-muted-foreground">
          Session, trades-per-day and risk limits are checked by the server at the replay time when you place the order. Nothing here blocks the order —
          it records whether you followed the strategy.
          {preview.manualOnly.length > 0 && ` Not auto-checked: ${preview.manualOnly.join(", ")}.`}
        </p>
      </div>
    </details>
  );
}
