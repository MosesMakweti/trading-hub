import { CircleCheck, ClipboardList, LineChart, ListChecks } from "lucide-react";

import { tiptapToPlainText } from "@/lib/tiptap-text";
import { KpiCard } from "@/components/analytics/kpi-card";
import { NoteBlock, WorkspaceField, formatSignedCurrency } from "@/components/journal/workspace/workspace-ui";
import { WorkflowProgress, type WorkflowStep } from "@/components/dashboard/workflow-progress";
import { RoutineSnapshotView } from "@/components/routine/routine-snapshot-view";
import type { JournalDayRecapDTO } from "@/types/today";

const BIAS_LABEL: Record<string, string> = {
  BULLISH: "Bullish",
  BEARISH: "Bearish",
  NEUTRAL: "Neutral",
};

const pct = (n: number | null, signed = false) =>
  n == null ? "—" : `${signed && n >= 0 ? "+" : ""}${n.toFixed(2)}%`;
const tone = (n: number | null): "success" | "danger" | undefined =>
  n == null ? undefined : n >= 0 ? "success" : "danger";

function Card({ icon: Icon, title, children }: { icon: typeof ListChecks; title: string; children: React.ReactNode }) {
  return (
    <div className="glass space-y-3 rounded-2xl p-4">
      <h3 className="flex items-center gap-1.5 text-sm font-medium">
        <Icon className="size-4 text-muted-foreground" />
        {title}
      </h3>
      {children}
    </div>
  );
}

/**
 * Read-only recap of a day's whole workflow (P7) — the workflow stepper plus
 * the frozen Pre-Session Routine / Plan / Daily Analytics summaries. Presentational
 * (server component); it renders the same reusable pieces the Today workspace
 * uses. Shown only when a TradingDay exists for the day.
 */
export function JournalDayRecap({
  recap,
  steps,
}: {
  recap: JournalDayRecapDTO;
  steps: WorkflowStep[];
}) {
  const { routine, plan, analytics: a } = recap;
  const biasValue =
    plan.bias == null
      ? undefined
      : `${BIAS_LABEL[plan.bias]}${plan.conviction ? ` · ${plan.conviction}/5 conviction` : ""}`;

  return (
    <section className="space-y-3">
      <WorkflowProgress steps={steps} title="Day workflow" />

      {routine.snapshot && routine.snapshot.sections.length > 0 && (
        <Card icon={ListChecks} title="Pre-Session Routine">
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
            <span className="text-muted-foreground tabular-nums">
              {routine.progress.completed}/{routine.progress.total} complete · {routine.progress.percent}%
            </span>
            {routine.readyAt && (
              <span className="inline-flex items-center gap-1 text-xs font-medium text-success">
                <CircleCheck className="size-3.5" />
                Confirmed ready to trade
              </span>
            )}
          </div>
          <RoutineSnapshotView snapshot={routine.snapshot} />
        </Card>
      )}

      <div className="grid grid-cols-1 gap-3">
        <Card icon={ClipboardList} title="Plan">
          <div className="grid grid-cols-2 gap-x-4 gap-y-2">
            <WorkspaceField label="Bias" value={biasValue} />
            <WorkspaceField
              label="Risk budget"
              value={plan.riskBudgetPercent == null ? undefined : `${plan.riskBudgetPercent}%`}
            />
          </div>
          <NoteBlock label="Key levels" text={tiptapToPlainText(plan.keyLevels, 400)} />
        </Card>
      </div>

      {a.totalTrades > 0 && (
        <div>
          <h3 className="mb-2 flex items-center gap-1.5 text-sm font-medium text-muted-foreground">
            <LineChart className="size-4" />
            Daily analytics
          </h3>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <KpiCard label="Trades" value={String(a.totalTrades)} sublabel={`${a.winningTrades}W · ${a.losingTrades}L`} />
            <KpiCard label="Win rate" value={pct(a.winRate)} />
            <KpiCard label="Net PnL" value={formatSignedCurrency(a.netPnl)} tone={tone(a.netPnl)} />
            <KpiCard label="Total return" value={pct(a.totalRR, true)} tone={tone(a.totalRR)} />
          </div>
        </div>
      )}
    </section>
  );
}
