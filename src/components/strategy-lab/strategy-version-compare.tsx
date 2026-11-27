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
import type { StrategyDiffEntry, StrategyVersionDiff, StrategyVersionDTO } from "@/types/strategies";

const CHANGE_BADGE: Record<StrategyDiffEntry["change"], { label: string; variant: "success" | "danger" | "outline" }> = {
  added: { label: "Added", variant: "success" },
  removed: { label: "Removed", variant: "danger" },
  changed: { label: "Changed", variant: "outline" },
  reordered: { label: "Reordered", variant: "outline" },
};

function DiffEntryRow({ entry }: { entry: StrategyDiffEntry }) {
  const badge = CHANGE_BADGE[entry.change];
  return (
    <li className="space-y-1">
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <Badge variant={badge.variant}>{badge.label}</Badge>
        <span className="font-medium">{entry.subject}</span>
      </div>
      {entry.fields.length > 0 && (
        <ul className="space-y-0.5 pl-2">
          {entry.fields.map((f, i) => (
            <li key={`${f.field}-${i}`} className="flex flex-wrap items-center gap-1.5 text-xs">
              <span className="text-muted-foreground">{f.field}</span>
              <span className="text-danger line-through tabular-nums">{f.from}</span>
              <ArrowRight className="size-3 shrink-0 text-muted-foreground" />
              <span className="text-success tabular-nums">{f.to}</span>
            </li>
          ))}
        </ul>
      )}
    </li>
  );
}

function DiffView({ diff }: { diff: StrategyVersionDiff }) {
  if (!diff.hasChanges) {
    return <p className="text-sm text-muted-foreground">No differences between these versions.</p>;
  }
  return (
    <div className="space-y-4">
      {diff.affectsScoring && (
        <p className="rounded-lg border border-warning/40 bg-warning/10 px-3 py-2 text-xs">
          These changes affect setup scoring (confluences, execution, setup types or sessions) — trades
          taken under each version were validated against different rules.
        </p>
      )}
      {diff.sections.map((section) => (
        <section key={section.key} className="space-y-2">
          <h4 className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
            {section.label}
          </h4>
          <ul className="space-y-2">
            {section.entries.map((entry, i) => (
              <DiffEntryRow key={`${entry.change}-${entry.subject}-${i}`} entry={entry} />
            ))}
          </ul>
        </section>
      ))}
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
