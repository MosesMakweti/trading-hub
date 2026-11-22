import { notFound } from "next/navigation";
import Link from "next/link";
import { ChevronLeft } from "lucide-react";

import { requireUser } from "@/server/guards";
import { getStudyDetail, SimStudyNotFoundError } from "@/server/services/simulation/sim-study.service";
import { FadeIn } from "@/components/shared/motion";
import { StatsKpis, StatsTable } from "@/components/simulation/stats-table";
import { AddSetupForm, ObservationList, StudyStatusSelect } from "@/components/simulation/studies/study-detail-client";

export default async function StudyPage({ params }: { params: Promise<{ studyId: string }> }) {
  const { studyId } = await params;
  const user = await requireUser();
  let detail;
  try {
    detail = await getStudyDetail(user.id, studyId);
  } catch (e) {
    if (e instanceof SimStudyNotFoundError) notFound();
    throw e;
  }
  const s = detail.study;
  const criteria = [
    { label: "Hypothesis", value: s.hypothesis },
    { label: "Setup criteria", value: s.setupCriteria },
    { label: "Confirmation", value: s.confirmationCriteria },
    { label: "Entry rules", value: s.entryRules },
    { label: "Exit rules", value: s.exitRules },
    { label: "Market conditions", value: s.marketConditions },
  ].filter((c) => c.value);

  return (
    <FadeIn className="mx-auto max-w-6xl space-y-8">
      <header className="space-y-3">
        <Link href="/backtesting/lab/studies" className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"><ChevronLeft className="size-3.5" /> All studies</Link>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0 space-y-1">
            <h1 className="text-2xl font-semibold tracking-tight">{s.name}</h1>
            <p className="text-sm text-muted-foreground">
              {[s.category, s.instruments.join(", ") || "Any instrument", s.timeframes.join(", "), s.strategyName && `Strategy: ${s.strategyName}`].filter(Boolean).join(" · ")}
            </p>
            {s.tags.length > 0 && <p className="text-xs text-muted-foreground">{s.tags.map((t) => `#${t}`).join("  ")}</p>}
          </div>
          <StudyStatusSelect studyId={s.id} status={s.status} />
        </div>
      </header>

      {criteria.length > 0 && (
        <dl className="grid gap-4 rounded-xl border border-border bg-card p-4 sm:grid-cols-2">
          {criteria.map((c) => (
            <div key={c.label}>
              <dt className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">{c.label}</dt>
              <dd className="mt-0.5 whitespace-pre-line text-sm">{c.value}</dd>
            </div>
          ))}
        </dl>
      )}

      <section aria-label="Evidence" className="space-y-3">
        <h2 className="text-lg font-semibold">Evidence</h2>
        <StatsKpis stats={detail.overall} />
      </section>

      <section aria-label="Setup variations" className="space-y-3">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <h2 className="text-lg font-semibold">Variations</h2>
          <AddSetupForm studyId={s.id} />
        </div>
        <StatsTable title="By setup variation" groups={detail.bySetup} emptyText="Record observations to compare variations." />
      </section>

      <div className="grid gap-6 lg:grid-cols-2">
        <StatsTable title="By instrument" groups={detail.byInstrument} />
        <StatsTable title="By timeframe" groups={detail.byTimeframe} emptyText="Observations recorded with a timeframe appear here." />
        <StatsTable title="By hour (server time)" groups={detail.byHour} />
        <StatsTable title="By weekday" groups={detail.byWeekday} />
      </div>

      <section aria-label="Observations" className="space-y-3">
        <h2 className="text-lg font-semibold">Observations <span className="text-sm font-normal text-muted-foreground tabular-nums">{detail.observations.length}</span></h2>
        <ObservationList studyId={s.id} observations={detail.observations} />
      </section>
    </FadeIn>
  );
}
