import { notFound } from "next/navigation";
import Link from "next/link";
import { AlertTriangle, ChevronLeft, FlaskConical } from "lucide-react";

import { requireUser } from "@/server/guards";
import { requireExperimentComparison, type ExperimentComparisonDTO } from "@/server/services/simulation/sim-strategy-analytics.service";
import { FadeIn } from "@/components/shared/motion";
import { Badge } from "@/components/ui/badge";
import { SampleBadge, StatsTable } from "@/components/simulation/stats-table";
import { DiffView } from "@/components/strategy-lab/strategy-version-compare";
import { fmtR, pnlTone } from "@/components/simulation/format";
import { cn } from "@/lib/utils";
import type { GroupResults } from "@/domain/simulation/strategy-comparison";

type Metric = { label: string; of: (g: GroupResults) => number | null; fmt: (n: number) => string; higherIsBetter?: boolean };

const METRICS: Metric[] = [
  { label: "Closed trades", of: (g) => g.overall.resolved, fmt: (n) => String(n) },
  { label: "Win rate", of: (g) => g.overall.winRate, fmt: (n) => `${Math.round(n)}%`, higherIsBetter: true },
  { label: "Net R", of: (g) => g.overall.netR, fmt: fmtR, higherIsBetter: true },
  { label: "Average R / expectancy", of: (g) => g.overall.expectancy, fmt: fmtR, higherIsBetter: true },
  { label: "Profit factor", of: (g) => g.overall.profitFactor, fmt: (n) => n.toFixed(2), higherIsBetter: true },
  { label: "Max drawdown (R)", of: (g) => g.overall.maxDrawdownR, fmt: fmtR, higherIsBetter: true },
  { label: "Avg execution score", of: (g) => g.averageExecutionScore, fmt: (n) => String(n), higherIsBetter: true },
  { label: "Rule adherence", of: (g) => g.ruleAdherence, fmt: (n) => `${n}%`, higherIsBetter: true },
];

/** Baseline vs experiment: configuration changes, results and caveats. */
export default async function ExperimentComparisonPage({ params }: { params: Promise<{ experimentId: string }> }) {
  const { experimentId } = await params;
  const user = await requireUser();
  const c = await requireExperimentComparison(user.id, experimentId);
  if (!c) notFound();
  const e = c.experiment;

  return (
    <FadeIn className="mx-auto max-w-6xl space-y-8">
      <header className="space-y-3">
        <Link href="/backtesting/lab" className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
          <ChevronLeft className="size-3.5" /> Strategy Lab
        </Link>
        <div className="space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="outline" className="gap-1 border-amber-500/50 text-amber-500">
              <FlaskConical className="size-3" /> {e.label}
            </Badge>
            <Badge variant="outline">{e.status.replaceAll("_", " ").toLowerCase()}</Badge>
          </div>
          <h1 className="text-2xl font-semibold tracking-tight">{e.name}</h1>
          <p className="text-sm text-muted-foreground">
            {e.baseline ? <>Compared with <span className="text-foreground">{e.baseline.name}</span> as it was when the experiment started.</> : "A new strategy built in the terminal (no baseline)."}
            {e.resultVersion ? ` Published as version ${e.resultVersion}.` : ""}
          </p>
        </div>
      </header>

      <section className="grid gap-4 md:grid-cols-2">
        <LogCard title="What changed, and why" text={e.hypothesis} />
        <LogCard title="Expected effect" text={e.expectedEffect} />
        <LogCard title="Actual outcome" text={e.actualOutcome} />
        <LogCard title="Notes" text={e.notes} />
      </section>

      {c.warnings.length > 0 && (
        <section aria-label="Caveats" className="space-y-2">
          {c.warnings.map((w) => (
            <p
              key={w.kind + w.message}
              className={cn(
                "flex items-start gap-2 rounded-lg border px-3 py-2 text-sm",
                w.kind === "PROFIT_ONLY" ? "border-border text-muted-foreground" : "border-amber-500/40 bg-amber-500/10",
              )}
            >
              <AlertTriangle className="mt-0.5 size-4 shrink-0" />
              {w.message}
            </p>
          ))}
        </section>
      )}

      {c.baseline && <ResultsTable c={c} />}

      {c.differences.length > 0 && (
        <section aria-label="Different test conditions" className="space-y-2">
          <h2 className="text-sm font-medium">Test conditions that differ</h2>
          <div className="overflow-x-auto rounded-xl border border-border">
            <table className="w-full text-sm">
              <thead className="text-left text-xs text-muted-foreground">
                <tr><th className="px-3 py-2">Condition</th><th className="px-3 py-2">Baseline sessions</th><th className="px-3 py-2">Experiment sessions</th></tr>
              </thead>
              <tbody>
                {c.differences.map((d) => (
                  <tr key={d.field} className="border-t border-border align-top">
                    <td className="px-3 py-2 font-medium">{d.field}</td>
                    <td className="px-3 py-2">{d.baseline.join("; ") || "—"}</td>
                    <td className="px-3 py-2">{d.experiment.join("; ") || "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      <section aria-label="Configuration changes" className="space-y-2">
        <h2 className="text-sm font-medium">Configuration changes from the baseline</h2>
        <div className="rounded-xl border border-border p-4">
          {e.changesFromBaseline ? (
            <DiffView diff={e.changesFromBaseline} emptyText="No configuration changes yet." />
          ) : (
            <p className="text-sm text-muted-foreground">
              {e.status === "ACTIVE" ? "A new strategy has no baseline to compare with." : "This experiment is closed; its configuration lives in the version or strategy it produced and in each session's frozen snapshot."}
            </p>
          )}
        </div>
      </section>

      <section className="grid gap-6 lg:grid-cols-2">
        {c.baseline && <SessionList title="Baseline sessions" sessions={c.baseline.sessions} />}
        <SessionList title="Experiment sessions" sessions={c.variation.sessions} />
      </section>

      <section className="grid gap-6 lg:grid-cols-2">
        {c.baseline && (
          <div className="space-y-6">
            <h2 className="text-sm font-medium text-muted-foreground">Baseline breakdowns</h2>
            <Breakdowns g={c.baseline.results} />
          </div>
        )}
        <div className="space-y-6">
          <h2 className="text-sm font-medium text-muted-foreground">Experiment breakdowns</h2>
          <Breakdowns g={c.variation.results} />
        </div>
      </section>

      <p className="text-xs text-muted-foreground">Not available: {c.unsupported.join(" ")}</p>
    </FadeIn>
  );
}

function LogCard({ title, text }: { title: string; text: string | null }) {
  return (
    <div className="rounded-xl border border-border p-3">
      <h2 className="text-xs text-muted-foreground">{title}</h2>
      <p className={cn("mt-1 text-sm whitespace-pre-wrap", !text && "text-muted-foreground")}>{text || "—"}</p>
    </div>
  );
}

function ResultsTable({ c }: { c: ExperimentComparisonDTO }) {
  const a = c.baseline!.results;
  const b = c.variation.results;
  return (
    <section aria-label="Results side by side" className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="text-sm font-medium">Results side by side</h2>
        {c.comparable ? <Badge variant="success">Same conditions</Badge> : <Badge variant="danger">Not directly comparable</Badge>}
      </div>
      <div className="overflow-x-auto rounded-xl border border-border">
        <table className="w-full text-sm tabular-nums">
          <thead className="text-left text-xs text-muted-foreground">
            <tr>
              <th className="px-3 py-2">Metric</th>
              <th className="px-3 py-2">Baseline <span className="font-normal">({a.sessions} session{a.sessions === 1 ? "" : "s"})</span></th>
              <th className="px-3 py-2">Experiment <span className="font-normal">({b.sessions} session{b.sessions === 1 ? "" : "s"})</span></th>
              <th className="px-3 py-2">Difference</th>
            </tr>
          </thead>
          <tbody>
            {METRICS.map((m) => {
              const x = m.of(a);
              const y = m.of(b);
              const delta = x != null && y != null ? y - x : null;
              return (
                <tr key={m.label} className="border-t border-border">
                  <td className="px-3 py-2 text-muted-foreground">{m.label}</td>
                  <td className="px-3 py-2">{x == null ? "—" : m.fmt(x)}</td>
                  <td className="px-3 py-2">{y == null ? "—" : m.fmt(y)}</td>
                  <td className={cn("px-3 py-2", delta != null && m.higherIsBetter && pnlTone(delta))}>
                    {delta == null || delta === 0 ? "—" : `${delta > 0 ? "+" : ""}${m.fmt(delta)}`}
                  </td>
                </tr>
              );
            })}
            <tr className="border-t border-border">
              <td className="px-3 py-2 text-muted-foreground">Sample</td>
              <td className="px-3 py-2"><SampleBadge sample={a.overall.sample} /></td>
              <td className="px-3 py-2"><SampleBadge sample={b.overall.sample} /></td>
              <td />
            </tr>
          </tbody>
        </table>
      </div>
      <p className="text-xs text-muted-foreground">
        Net R after commissions and swaps, from closed simulated positions with a stop. Execution score and rule adherence cover trades placed with the strategy checklist.
      </p>
    </section>
  );
}

function SessionList({ title, sessions }: { title: string; sessions: ExperimentComparisonDTO["variation"]["sessions"] }) {
  return (
    <section aria-label={title} className="space-y-2">
      <h2 className="text-sm font-medium">{title}</h2>
      {sessions.length === 0 ? (
        <p className="text-xs text-muted-foreground">No sessions yet.</p>
      ) : (
        <ul className="divide-y divide-border rounded-xl border border-border text-sm">
          {sessions.map((s) => (
            <li key={s.accountId} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2">
              <Link href={`/backtesting/lab/results/${s.accountId}`} className="font-medium hover:underline">{s.name}</Link>
              <span className="text-xs text-muted-foreground">{Object.keys(s.pins).join(", ")} · {s.periodStart} → {s.periodEnd}</span>
              <span className="ml-auto text-xs text-muted-foreground tabular-nums">{s.closedTrades} closed · {s.status.toLowerCase()}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function Breakdowns({ g }: { g: GroupResults }) {
  return (
    <>
      <StatsTable title="By session" groups={g.bySession} />
      <StatsTable title="By instrument" groups={g.byInstrument} />
      <StatsTable title="By setup type" groups={g.bySetupType} />
      <StatsTable title="Rules followed vs broken" groups={g.byRuleAdherence} emptyText="No trades placed with the strategy checklist yet." />
    </>
  );
}
