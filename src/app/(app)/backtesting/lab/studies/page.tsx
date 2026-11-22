import Link from "next/link";

import { requireUser } from "@/server/guards";
import { listStudies } from "@/server/services/simulation/sim-study.service";
import { FadeIn } from "@/components/shared/motion";
import { SimulationBadge } from "@/components/backtesting/simulation-badge";
import { SimulationNav } from "@/components/simulation/simulation-nav";
import { CreateStudyDialog } from "@/components/simulation/studies/create-study-dialog";
import { SampleBadge } from "@/components/simulation/stats-table";
import { fmtR, pnlTone } from "@/components/simulation/format";
import { cn } from "@/lib/utils";

/** The study library: every concept being studied, with its headline evidence. */
export default async function StudiesPage() {
  const user = await requireUser();
  const studies = await listStudies(user.id);
  const visible = studies.filter((s) => s.status !== "ARCHIVED");
  const archived = studies.length - visible.length;

  return (
    <FadeIn className="mx-auto max-w-6xl space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="space-y-2">
          <SimulationBadge />
          <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">Studies</h1>
          <p className="max-w-2xl text-sm text-muted-foreground">Study one setup at a time. Record each occurrence while you replay, traded or not, and compare its variations as the evidence grows.</p>
        </div>
        <CreateStudyDialog />
      </div>
      <SimulationNav />
      {visible.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border px-6 py-12 text-center">
          <h2 className="font-semibold">No studies yet</h2>
          <p className="mx-auto mt-1 max-w-md text-sm text-muted-foreground">Pick a concept, such as a London liquidity sweep or an FVG retrace, and list the variations you want to compare.</p>
          <div className="mt-4 flex justify-center"><CreateStudyDialog trigger="Create your first study" /></div>
        </div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {visible.map((s) => (
            <Link key={s.id} href={`/backtesting/lab/studies/${s.id}`} className="block rounded-xl border border-border bg-card p-4 shadow-sm transition-colors hover:border-foreground/20">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <h2 className="truncate font-medium">{s.name}</h2>
                  <p className="mt-0.5 truncate text-xs text-muted-foreground">{[s.category, s.instruments.join(", ")].filter(Boolean).join(" · ") || "Any instrument"}</p>
                </div>
                <span className="rounded border border-border px-1.5 py-px text-[10px] font-medium uppercase tracking-wider text-muted-foreground">{s.status.toLowerCase()}</span>
              </div>
              <dl className="mt-4 grid grid-cols-3 gap-3">
                <div><dt className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">Seen</dt><dd className="font-mono text-sm tabular-nums">{s.observations}</dd></div>
                <div><dt className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">Traded</dt><dd className="font-mono text-sm tabular-nums">{s.stats.executed}</dd></div>
                <div><dt className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">Net R</dt><dd className={cn("font-mono text-sm tabular-nums", pnlTone(s.stats.netR))}>{s.stats.netR == null ? "—" : fmtR(s.stats.netR)}</dd></div>
              </dl>
              <div className="mt-3 flex items-center gap-2 text-xs text-muted-foreground"><SampleBadge sample={s.stats.sample} /> {s.setups} variation{s.setups === 1 ? "" : "s"}</div>
            </Link>
          ))}
        </div>
      )}
      {archived > 0 && <p className="text-xs text-muted-foreground">{archived} archived stud{archived === 1 ? "y" : "ies"} hidden.</p>}
    </FadeIn>
  );
}
