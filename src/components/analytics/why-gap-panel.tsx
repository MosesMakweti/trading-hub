import type { AttributionSummary } from "@/domain/analytics/counterfactual-engine";
import { CATEGORY_LABEL, LEAKAGE_TONE } from "@/components/analytics/leakage-meta";

/**
 * "Why is there a gap?" — the attribution breakdown. Each category's share of the
 * measurable avoidable gap is a single-hue bar; flagged-but-unquantified breaches
 * (real, but no objective R) are listed separately so a known-unknown never masquerades
 * as measured R. See domain/analytics/counterfactual-engine.
 */
export function WhyGapPanel({ summary }: { summary: AttributionSummary }) {
  const { byCategory, totalAvoidableGapR } = summary;

  if (byCategory.length === 0) {
    return (
      <div className="rounded-xl border border-border bg-background/40 p-3 text-xs text-muted-foreground">
        No avoidable discrepancy — process was followed on every trade in range.
      </div>
    );
  }

  const measured = byCategory.filter((c) => c.measuredR > 0);
  const flaggedOnly = byCategory.filter((c) => c.measuredR === 0 && c.flaggedCount > 0);

  return (
    <div className="space-y-3 rounded-xl border border-border bg-background/40 p-3">
      <div className="flex items-baseline justify-between">
        <h4 className="text-xs font-medium text-muted-foreground">Why is there a gap?</h4>
        <span className="text-xs tabular-nums text-muted-foreground">
          {totalAvoidableGapR.toFixed(2)}R avoidable
        </span>
      </div>

      <div className="space-y-2">
        {measured.map((c) => (
          <div key={c.category} className="space-y-1">
            <div className="flex items-center justify-between text-xs">
              <span className="flex items-center gap-1.5">
                <span className="size-2 rounded-full" style={{ background: LEAKAGE_TONE[c.category] }} />
                {CATEGORY_LABEL[c.category]}
                {c.flaggedCount > 0 && (
                  <span className="text-[10px] text-muted-foreground">
                    +{c.flaggedCount} flagged
                  </span>
                )}
              </span>
              <span className="tabular-nums text-muted-foreground">
                {c.measuredR.toFixed(2)}R · {c.sharePercent ?? 0}%
              </span>
            </div>
            <div className="h-1.5 overflow-hidden rounded-full bg-muted">
              <div
                className="h-full rounded-full"
                style={{ width: `${c.sharePercent ?? 0}%`, background: LEAKAGE_TONE[c.category] }}
              />
            </div>
          </div>
        ))}
      </div>

      {flaggedOnly.length > 0 && (
        <div className="border-t border-border pt-2 text-[11px] text-muted-foreground">
          <span className="font-medium">Flagged (R not measurable): </span>
          {flaggedOnly
            .map((c) => `${CATEGORY_LABEL[c.category]} (${c.flaggedCount})`)
            .join(" · ")}
        </div>
      )}
    </div>
  );
}
