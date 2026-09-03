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
