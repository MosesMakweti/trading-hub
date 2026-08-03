"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { GitCommitVertical, History, Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { publishStrategyVersion } from "@/actions/strategies.actions";
import { StrategyVersionCompare } from "@/components/strategy-lab/strategy-version-compare";
import type { StrategyVersionDTO } from "@/types/strategies";

function formatDate(iso: string) {
  return new Date(iso).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

function VersionCard({ version }: { version: StrategyVersionDTO }) {
  const s = version.summary;
  const chips = [
    `${s.arsenalCount} arsenal`,
    `${s.frameworkStepTitles.length} framework`,
    `${s.timeframeCount} timeframe${s.timeframeCount === 1 ? "" : "s"} · ${s.checkpointCount} checkpoint${s.checkpointCount === 1 ? "" : "s"}`,
    `${s.entryModelNames.length} entry model${s.entryModelNames.length === 1 ? "" : "s"}`,
    `${s.customRuleCount} rule${s.customRuleCount === 1 ? "" : "s"}`,
    `${s.partialTpCount} partial TP${s.partialTpCount === 1 ? "" : "s"}`,
  ];

  return (
    <li className="glass space-y-2 rounded-2xl p-4">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className="bg-brand-gradient inline-flex size-7 items-center justify-center rounded-full text-white shadow-glow">
            <GitCommitVertical className="size-4" />
          </span>
          <span className="font-semibold tabular-nums">Version {version.version}</span>
        </div>
        <time className="text-xs text-muted-foreground tabular-nums" dateTime={version.createdAt}>
          {formatDate(version.createdAt)}
        </time>
      </div>

      {version.note && <p className="text-sm whitespace-pre-wrap">{version.note}</p>}

      <div className="flex flex-wrap gap-1.5">
        {chips.map((c) => (
          <Badge key={c} variant="outline">
            {c}
          </Badge>
        ))}
      </div>

      {(s.entryModelNames.length > 0 || s.frameworkStepTitles.length > 0) && (
        <div className="space-y-1 border-t border-border/60 pt-2 text-xs text-muted-foreground">
          {s.frameworkStepTitles.length > 0 && (
            <div>
              <span className="text-foreground">Framework:</span> {s.frameworkStepTitles.join(" → ")}
            </div>
          )}
          {s.entryModelNames.length > 0 && (
            <div>
              <span className="text-foreground">Entry models:</span> {s.entryModelNames.join(", ")}
            </div>
          )}
          {s.applicableAssets.length > 0 && (
            <div>
              <span className="text-foreground">Assets:</span> {s.applicableAssets.join(", ")}
            </div>
          )}
        </div>
      )}
    </li>
  );
}

export function StrategyVersionsSection({
  strategyId,
  currentVersion,
  initialVersions,
}: {
  strategyId: string;
  currentVersion: number;
  initialVersions: StrategyVersionDTO[];
}) {
  const router = useRouter();
  const [note, setNote] = useState("");
  const [pending, startTransition] = useTransition();

  function publish() {
    startTransition(async () => {
      const result = await publishStrategyVersion(strategyId, note);
      if (!result.success) {
        toast.error(result.error);
        return;
      }
      toast.success(`Published version ${currentVersion}.`);
      setNote("");
      router.refresh();
    });
  }

  return (
    <div className="space-y-5">
      {/* Publish the current working version */}
      <div className="glass space-y-3 rounded-2xl p-4">
        <div>
          <h3 className="text-sm font-medium">
            Publish version <span className="tabular-nums">{currentVersion}</span>
          </h3>
          <p className="text-xs text-muted-foreground">
            Snapshots the strategy exactly as it is now as version {currentVersion}, then starts a
            fresh working version {currentVersion + 1}. Trades keep the version they were taken
            under.
          </p>
        </div>
        <Textarea
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="What changed in this version? (optional)"
          rows={2}
          aria-label="Version note"
        />
        <div className="flex justify-end">
          <Button type="button" onClick={publish} disabled={pending} className="gap-1.5">
            {pending ? <Loader2 className="size-3.5 animate-spin" /> : <GitCommitVertical className="size-3.5" />}
            Publish version {currentVersion}
          </Button>
        </div>
      </div>

      {/* Compare (only meaningful once something is published) */}
      {initialVersions.length > 0 && (
        <StrategyVersionCompare
          strategyId={strategyId}
          currentVersion={currentVersion}
          versions={initialVersions}
        />
      )}

      {/* History */}
      {initialVersions.length === 0 ? (
        <div className="flex flex-col items-center justify-center gap-2 rounded-2xl border border-dashed border-border p-8 text-center">
          <History className="size-7 text-muted-foreground" />
          <p className="text-sm font-medium">No versions published yet</p>
          <p className="max-w-sm text-xs text-muted-foreground">
            Publish a version to capture how this strategy looks today. Each snapshot is kept
            permanently so you can see how the strategy evolved.
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          <div className="text-xs font-medium text-muted-foreground">
            Published history ({initialVersions.length})
          </div>
          <ul className="space-y-3">
            {initialVersions.map((v) => (
              <VersionCard key={v.id} version={v} />
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
