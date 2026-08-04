"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { ArrowRight, Loader2 } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { compareStrategyVersions } from "@/actions/strategies.actions";
import type { ListDiff, StrategyVersionDiff, StrategyVersionDTO } from "@/types/strategies";

function ListDiffRow({ label, diff, extra }: { label: string; diff: ListDiff; extra?: string }) {
  if (diff.added.length === 0 && diff.removed.length === 0 && !extra) return null;
  return (
    <div className="space-y-1">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="flex flex-wrap gap-1.5">
        {diff.added.map((x) => (
          <Badge key={`+${x}`} variant="success">
            + {x}
          </Badge>
        ))}
        {diff.removed.map((x) => (
          <Badge key={`-${x}`} variant="danger">
            − {x}
          </Badge>
        ))}
        {extra && <Badge variant="outline">{extra}</Badge>}
      </div>
    </div>
  );
}

function ScalarRow({ label, from, to }: { label: string; from: string; to: string }) {
  return (
    <div className="flex flex-wrap items-center gap-2 text-sm">
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className="text-danger line-through tabular-nums">{from || "—"}</span>
      <ArrowRight className="size-3 text-muted-foreground" />
      <span className="text-success tabular-nums">{to || "—"}</span>
    </div>
  );
}

function DiffView({ diff }: { diff: StrategyVersionDiff }) {
  if (!diff.hasChanges) {
    return <p className="text-sm text-muted-foreground">No differences between these versions.</p>;
  }
  const tm = diff.tradeManagement;
  const countLabel = (n: number, noun: string) =>
    `${n > 0 ? "+" : ""}${n} ${noun}${Math.abs(n) === 1 ? "" : "s"}`;

  return (
    <div className="space-y-3">
      {diff.nameChange && <ScalarRow label="Name" from={diff.nameChange.from} to={diff.nameChange.to} />}
      {diff.statusChange && (
        <ScalarRow label="Status" from={diff.statusChange.from} to={diff.statusChange.to} />
      )}
      {diff.descriptionChanged && (
        <div className="text-sm">
          <span className="text-xs text-muted-foreground">Description</span>{" "}
          <span className="text-muted-foreground">changed</span>
        </div>
      )}

      <ListDiffRow label="Applicable assets" diff={diff.applicableAssets} />
      <ListDiffRow label="Arsenal concepts" diff={diff.arsenalConcepts} />
      <ListDiffRow
        label="Framework steps"
        diff={diff.frameworkSteps}
        extra={diff.frameworkSteps.reordered ? "reordered" : undefined}
      />
      <ListDiffRow label="Timeframes" diff={diff.timeframes} />
      <ListDiffRow label="Entry models" diff={diff.entryModels} />

      {(tm.maxRiskPercent || tm.maxHoldingTime || tm.customRuleCountDelta !== 0 || tm.partialTpCountDelta !== 0) && (
        <div className="space-y-1.5 border-t border-border/60 pt-2">
          <div className="text-xs text-muted-foreground">Trade management</div>
          {tm.maxRiskPercent && (
            <ScalarRow
              label="Max risk"
              from={tm.maxRiskPercent.from == null ? "" : `${tm.maxRiskPercent.from}%`}
              to={tm.maxRiskPercent.to == null ? "" : `${tm.maxRiskPercent.to}%`}
            />
          )}
          {tm.maxHoldingTime && (
            <ScalarRow label="Max hold" from={tm.maxHoldingTime.from ?? ""} to={tm.maxHoldingTime.to ?? ""} />
          )}
          <div className="flex flex-wrap gap-1.5">
            {tm.customRuleCountDelta !== 0 && (
              <Badge variant={tm.customRuleCountDelta > 0 ? "success" : "danger"}>
                {countLabel(tm.customRuleCountDelta, "rule")}
              </Badge>
            )}
            {tm.partialTpCountDelta !== 0 && (
              <Badge variant={tm.partialTpCountDelta > 0 ? "success" : "danger"}>
                {countLabel(tm.partialTpCountDelta, "partial TP")}
              </Badge>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export function StrategyVersionCompare({
  strategyId,
  currentVersion,
  versions,
}: {
  strategyId: string;
  currentVersion: number;
  versions: StrategyVersionDTO[];
}) {
  const options = [
    { value: "current", label: `Current draft (v${currentVersion})` },
    ...versions.map((v) => ({ value: String(v.version), label: `Version ${v.version}` })),
  ];
  // Default: latest published version → current draft (the most useful "what have
  // I changed since I published?" view).
  const [base, setBase] = useState(String(versions[0]?.version ?? "current"));
  const [target, setTarget] = useState("current");
  const [diff, setDiff] = useState<StrategyVersionDiff | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    let active = true;
    void (async () => {
      setLoading(true);
      const result = await compareStrategyVersions(strategyId, base, target);
      if (!active) return;
      if (result.success) setDiff(result.diff);
      else {
        setDiff(null);
        toast.error(result.error);
      }
      setLoading(false);
    })();
    return () => {
      active = false;
    };
  }, [strategyId, base, target]);

  return (
    <div className="glass space-y-3 rounded-2xl p-4">
      <h3 className="text-sm font-medium">Compare versions</h3>
      <div className="flex flex-wrap items-center gap-2">
        <Select items={options} value={base} onValueChange={(v) => setBase(v ?? "current")}>
          <SelectTrigger className="w-48">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {options.map((o) => (
              <SelectItem key={o.value} value={o.value}>
                {o.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <ArrowRight className="size-4 text-muted-foreground" />
        <Select items={options} value={target} onValueChange={(v) => setTarget(v ?? "current")}>
          <SelectTrigger className="w-48">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {options.map((o) => (
              <SelectItem key={o.value} value={o.value}>
                {o.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {loading && <Loader2 className="size-4 animate-spin text-muted-foreground" />}
      </div>

      <div className="border-t border-border/60 pt-3">
        {diff ? <DiffView diff={diff} /> : !loading && (
          <p className="text-sm text-muted-foreground">Select two versions to compare.</p>
        )}
      </div>
    </div>
  );
}
