import { Loader2 } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import type { StrategyReferenceDTO } from "@/types/strategies";

function ChipRow({ label, items }: { label: string; items: string[] }) {
  return (
    <div className="space-y-1">
      <div className="text-xs text-muted-foreground">{label}</div>
      {items.length ? (
        <div className="flex flex-wrap gap-1.5">
          {items.map((item) => (
            <Badge key={item} variant="outline">
              {item}
            </Badge>
          ))}
        </div>
      ) : (
        <p className="text-xs text-muted-foreground/50 italic">None defined.</p>
      )}
    </div>
  );
}

/**
 * Read-only reference context pulled from the selected strategy (Phase 7). Shows
 * the strategy's assets / entry models / framework / trade-management as guidance
 * while logging the trade — the Journal *references* the strategy, it never copies
 * it, and it deliberately never surfaces Arsenal.
 */
export function StrategyReferencePanel({
  reference,
  loading,
}: {
  reference: StrategyReferenceDTO | null;
  loading: boolean;
}) {
  if (loading) {
    return (
      <div className="flex items-center gap-2 rounded-xl border border-dashed border-border p-3 text-xs text-muted-foreground">
        <Loader2 className="size-3.5 animate-spin" />
        Loading strategy reference…
      </div>
    );
  }
  if (!reference) return null;

  const tm = reference.tradeManagement;

  return (
    <div className="space-y-3 rounded-xl border border-border bg-background/30 p-3">
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-medium text-muted-foreground">
          Reference from <span className="text-foreground">{reference.name}</span>
          <span className="ml-1 tabular-nums">v{reference.version}</span>
        </span>
        <span className="text-[10px] text-muted-foreground/60">referenced, not copied</span>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <ChipRow label="Applicable assets" items={reference.applicableAssets} />
        <ChipRow label="Entry models" items={reference.entryModels} />
      </div>

      <div className="space-y-1">
        <div className="text-xs text-muted-foreground">Framework</div>
        {reference.frameworkSteps.length ? (
          <ol className="ml-4 list-decimal space-y-0.5 text-sm marker:text-muted-foreground">
            {reference.frameworkSteps.map((step, i) => (
              <li key={`${step}-${i}`}>{step}</li>
            ))}
          </ol>
        ) : (
          <p className="text-xs text-muted-foreground/50 italic">No framework steps.</p>
        )}
      </div>

      {tm && (
        <div className="space-y-1.5 border-t border-border/60 pt-2">
          <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
            {tm.maxRiskPercent != null && (
              <span>
                Max risk: <span className="text-foreground tabular-nums">{tm.maxRiskPercent}%</span>
              </span>
            )}
            {tm.maxHoldingTime && (
              <span>
                Max hold: <span className="text-foreground">{tm.maxHoldingTime}</span>
              </span>
            )}
          </div>
          {tm.customRules.length > 0 && (
            <ul className="ml-4 list-disc space-y-0.5 text-sm marker:text-muted-foreground">
              {tm.customRules.map((rule, i) => (
                <li key={`${rule}-${i}`}>{rule}</li>
              ))}
            </ul>
          )}
          {tm.partialTakeProfits.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {tm.partialTakeProfits.map((tp, i) => (
                <Badge key={i} variant="secondary">
                  {tp.trigger ?? "TP"}
                  {tp.percentToClose != null ? ` · ${tp.percentToClose}%` : ""}
                </Badge>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
