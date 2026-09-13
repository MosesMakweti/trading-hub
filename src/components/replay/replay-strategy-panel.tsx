"use client";

import { useState } from "react";
import { Info } from "lucide-react";

import { cn } from "@/lib/utils";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { TAG_STYLES } from "@/components/ui/tag";
import { EmptyState } from "@/components/shared/empty-state";
import type { HistoricalStrategyContextDTO } from "@/types/replay";

type StrategyPanelTab = "framework" | "entry-models" | "confluences" | "setup-types" | "management";

/**
 * Strategy / Process Panel (Stage 12 §8-9) — the frozen `StrategyVersion.
 * snapshot` for the exact version active at the time being reviewed, NEVER
 * today's live Strategy Lab config. Purely a reference read model; no
 * checklist interaction is wired yet (that arrives with the candle replay
 * engine, once there's a moment in market time to check conditions AT).
 */
export function ReplayStrategyPanel({ context }: { context: HistoricalStrategyContextDTO | null }) {
  const [tab, setTab] = useState<StrategyPanelTab>("framework");

  if (!context) {
    return (
      <EmptyState
        icon={Info}
        title="No Strategy scoped"
        description="This review covers All Trading, or the scoped strategy has no published version to show as historical reference."
      />
    );
  }

  const { snapshot } = context;

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
        <span>
          Reference: <span className="font-medium text-foreground">{context.strategyName}</span> · v{context.version}
        </span>
        <span className="italic">most recent published version — not necessarily pinned to a specific historical moment yet</span>
      </div>

      <Tabs value={tab} onValueChange={(v) => setTab(v as typeof tab)}>
        <TabsList className="w-max">
          <TabsTrigger value="framework">Framework</TabsTrigger>
          <TabsTrigger value="entry-models">Entry Models</TabsTrigger>
          <TabsTrigger value="confluences">Confluences</TabsTrigger>
          <TabsTrigger value="setup-types">Setup Types</TabsTrigger>
          <TabsTrigger value="management">Trade Management</TabsTrigger>
        </TabsList>

        <TabsContent value="framework" className="mt-3">
          {snapshot.frameworkSteps.length === 0 ? (
            <Empty text="No framework steps recorded for this version." />
          ) : (
            <ol className="list-inside list-decimal space-y-1.5 text-sm">
              {snapshot.frameworkSteps.map((s) => (
                <li key={s.id}>{s.title}</li>
              ))}
            </ol>
          )}
        </TabsContent>

        <TabsContent value="entry-models" className="mt-3">
          {snapshot.entryModels.length === 0 ? (
            <Empty text="No Entry Models recorded for this version." />
          ) : (
            <div className="flex flex-wrap gap-1.5">
              {snapshot.entryModels.map((m) => (
                <span key={m.id} className="rounded-md border border-border bg-background/40 px-2 py-1 text-xs">
                  {m.name}
                </span>
              ))}
            </div>
          )}
        </TabsContent>

        <TabsContent value="confluences" className="mt-3 space-y-4">
          <ConfluenceList title="Confluences" items={snapshot.confluences ?? []} />
          <ConfluenceList title="Execution Confirmations" items={snapshot.execution ?? []} />
        </TabsContent>

        <TabsContent value="setup-types" className="mt-3">
          {(snapshot.setupTypes ?? []).length === 0 ? (
            <Empty text="No Setup Types recorded for this version." />
          ) : (
            <div className="space-y-2">
              {(snapshot.setupTypes ?? []).map((st) => (
                <div key={st.name} className="rounded-lg border border-border bg-background/40 p-2.5 text-sm">
                  <div className="font-medium">{st.name}</div>
                  <div className="text-xs text-muted-foreground">
                    {st.scenarios.length} scenario{st.scenarios.length === 1 ? "" : "s"} ({st.scenarios.map((s) => s.direction).join(", ") || "none"})
                  </div>
                </div>
              ))}
            </div>
          )}
        </TabsContent>

        <TabsContent value="management" className="mt-3 text-sm">
          {snapshot.tradeManagement ? (
            <div className="grid grid-cols-2 gap-3 text-xs text-muted-foreground sm:grid-cols-3">
              <div>Max risk / trade: {snapshot.tradeManagement.maxRiskPercent != null ? `${snapshot.tradeManagement.maxRiskPercent}%` : "—"}</div>
              <div>Max daily risk: {snapshot.tradeManagement.maxDailyRiskPercent != null ? `${snapshot.tradeManagement.maxDailyRiskPercent}%` : "—"}</div>
              <div>Max trades/day: {snapshot.tradeManagement.maxTradesPerDay ?? "—"}</div>
              <div>Max holding time: {snapshot.tradeManagement.maxHoldingTime ?? "—"}</div>
              <div>Partial TPs: {snapshot.tradeManagement.partialTakeProfits.length}</div>
              <div>Custom rules: {snapshot.tradeManagement.customRules.length}</div>
            </div>
          ) : (
            <Empty text="No Trade Management rules recorded for this version." />
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}

function Empty({ text }: { text: string }) {
  return <p className="text-xs text-muted-foreground/60 italic">{text}</p>;
}

function ConfluenceList({
  title,
  items,
}: {
  title: string;
  items: { name: string; mandatory: boolean; weight: number | null; color: keyof typeof TAG_STYLES }[];
}) {
  return (
    <div className="space-y-1.5">
      <p className="text-xs font-medium text-muted-foreground uppercase">{title}</p>
      {items.length === 0 ? (
        <Empty text="None recorded." />
      ) : (
        <div className="flex flex-wrap gap-1.5">
          {items.map((c) => (
            <span
              key={c.name}
              className={cn(
                "inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-xs",
                TAG_STYLES[c.color]?.chip ?? TAG_STYLES.GRAY.chip,
              )}
            >
              {c.name}
              {c.mandatory && <span className="text-[10px] font-semibold uppercase opacity-70">req</span>}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
