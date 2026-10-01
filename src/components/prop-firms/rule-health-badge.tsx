import { Badge } from "@/components/ui/badge";
import type { RuleHealthDTO } from "@/types/prop-firms";

const STATE_LABEL: Record<string, string> = {
  SAFE: "Safe",
  APPROACHING: "Approaching",
  CRITICAL: "Critical",
  BREACHED: "Breached",
  TARGET_REACHED: "Target reached",
  AWAITING_CONFIRMATION: "Awaiting confirmation",
  NOT_ENOUGH_DATA: "Not enough data",
  MANUAL_TRACKING: "Manual tracking",
};

const STATE_VARIANT: Record<string, "default" | "secondary" | "success" | "danger" | "warning" | "outline"> = {
  SAFE: "success",
  APPROACHING: "warning",
  CRITICAL: "danger",
  BREACHED: "danger",
  TARGET_REACHED: "success",
  AWAITING_CONFIRMATION: "secondary",
  NOT_ENOUGH_DATA: "outline",
  MANUAL_TRACKING: "outline",
};

export function RuleHealthBadge({ health }: { health: RuleHealthDTO | undefined }) {
  if (!health) {
    return (
      <Badge variant="outline" title="No live evaluation for this rule">
        Not enough data
      </Badge>
    );
  }
  return (
    <Badge variant={STATE_VARIANT[health.state] ?? "outline"} title={health.detail}>
      {STATE_LABEL[health.state] ?? health.state}
      {health.percentConsumed != null && health.state !== "MANUAL_TRACKING" && health.state !== "NOT_ENOUGH_DATA" && (
        <span className="ml-1 opacity-80">{Math.round(health.percentConsumed)}%</span>
      )}
    </Badge>
  );
}

// Status colour per rule state — status meaning (good → caution → critical),
// always shown with the state label, never colour alone.
const STATE_BAR: Record<string, string> = {
  SAFE: "bg-viz-profit",
  TARGET_REACHED: "bg-viz-profit",
  APPROACHING: "bg-viz-warning",
  CRITICAL: "bg-viz-loss",
  BREACHED: "bg-viz-loss",
};

/**
 * RuleMeter — a prop-firm rule as a meter: how much of the target is reached
 * or of the limit consumed (`percentConsumed`, the rule engine's own figure),
 * tinted by the rule's state, with the state label beside it and the rule
 * engine's own `detail` text (which carries the right units — rules mix money,
 * percentages and day counts) on hover. Falls back to the badge when there's
 * no live measure.
 */
export function RuleMeter({ health }: { health: RuleHealthDTO | undefined }) {
  if (!health || health.percentConsumed == null || health.state === "MANUAL_TRACKING" || health.state === "NOT_ENOUGH_DATA") {
    return <RuleHealthBadge health={health} />;
  }
  const pct = Math.max(0, Math.min(100, health.percentConsumed));
  return (
    <div className="space-y-1" title={health.detail}>
      <div className="flex items-baseline justify-between gap-2 text-[11px]">
        <span className="truncate text-muted-foreground">{health.ruleName}</span>
        <span className="shrink-0 font-medium tabular-nums">
          {STATE_LABEL[health.state] ?? health.state} · {Math.round(health.percentConsumed)}%
        </span>
      </div>
      <div className="h-1.5 overflow-hidden rounded-full bg-muted" role="meter" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(pct)} aria-label={`${health.ruleName}: ${Math.round(health.percentConsumed)}%`}>
        <div className={`h-full rounded-full ${STATE_BAR[health.state] ?? "bg-viz-neutral"}`} style={{ width: `${pct}%` }} />
      </div>
      <div className="truncate text-[10px] text-muted-foreground">{health.detail}</div>
    </div>
  );
}
