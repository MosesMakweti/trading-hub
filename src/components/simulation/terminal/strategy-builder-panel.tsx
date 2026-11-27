"use client";

import { useCallback, useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { FlaskConical, GitBranch, Loader2, Lock, Play, RefreshCw, Save, Sparkles, Trash2, Wand2 } from "lucide-react";

import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import { ArsenalSection } from "@/components/strategy-lab/arsenal-section";
import { FrameworkSection } from "@/components/strategy-lab/framework-section";
import { TimeframesSection } from "@/components/strategy-lab/timeframes-section";
import { EntryModelsSection } from "@/components/strategy-lab/entry-models-section";
import { TradeManagementSection } from "@/components/strategy-lab/trade-management-section";
import { SetupTypesSection } from "@/components/strategy-lab/setup-types-section";
import { StrategyChecklistSection } from "@/components/strategy-lab/sot/strategy-checklist-section";
import { StrategySessionsSection } from "@/components/strategy-lab/sot/strategy-sessions-section";
import { StrategyVersionSnapshotView } from "@/components/strategy-lab/strategy-version-snapshot-view";
import { DiffView } from "@/components/strategy-lab/strategy-version-compare";
import { computeExpectancy } from "@/domain/performance/expectancy";
import { flushPendingAutosaves } from "@/hooks/use-debounced-autosave";
import {
  cloneSessionAction,
  createBuildExperimentAction,
  discardExperimentAction,
  forkExperimentAction,
  getExperimentAction,
  getTerminalStrategyContextAction,
  loadStrategyWorkspaceAction,
  promoteExperimentAction,
  saveExperimentAsVersionAction,
  updateExperimentLogAction,
  type TerminalStrategyContext,
} from "@/actions/strategy-experiments.actions";
import type { StrategyWorkspaceData } from "@/server/services/strategy-workspace.service";
import type { StrategyExperimentDetailDTO } from "@/types/strategy-experiments";

const SECTIONS = [
  { key: "framework", label: "Framework" },
  { key: "entry", label: "Entry models" },
  { key: "confluences", label: "Confluences" },
  { key: "execution", label: "Execution" },
  { key: "sessions", label: "Sessions" },
  { key: "setups", label: "Setup types" },
  { key: "management", label: "Trade mgmt" },
  { key: "timeframes", label: "Timeframes" },
  { key: "arsenal", label: "Arsenal" },
  { key: "log", label: "Log" },
  { key: "changes", label: "Changes" },
] as const;
type SectionKey = (typeof SECTIONS)[number]["key"];

const NO_LIVE_STATS = computeExpectancy([]);

function changeCount(e: StrategyExperimentDetailDTO | null) {
  return e?.changesFromBaseline?.sections.reduce((n, s) => n + s.entries.length, 0) ?? 0;
}

/**
 * The Strategy Builder embedded in the Backtesting terminal.
 *
 * It edits real Strategy Lab data through the SAME section components and
 * server actions as /strategy-lab — never a parallel model. What it edits is
 * always an isolated experiment (a hidden working copy): the original
 * strategy is shown read-only and only changes when the trader explicitly
 * saves an experiment back as a new version. The session's own results stay
 * tied to the configuration it froze when it was created.
 */
export function StrategyBuilderPanel({ accountId, onSessionCreated }: { accountId: string; onSessionCreated?: (accountId: string) => void }) {
  const router = useRouter();
  const [context, setContext] = useState<TerminalStrategyContext | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  /** The experiment being edited (null = viewing the session's frozen original). */
  const [experimentId, setExperimentId] = useState<string | null>(null);
  const [experiment, setExperiment] = useState<StrategyExperimentDetailDTO | null>(null);
  const [workspace, setWorkspace] = useState<StrategyWorkspaceData | null>(null);
  const [section, setSection] = useState<SectionKey>("confluences");
  /** Bumped to remount section editors with freshly loaded data. */
  const [dataVersion, setDataVersion] = useState(0);
  const [pending, startTransition] = useTransition();
  const [buildName, setBuildName] = useState("");
  const [confirm, setConfirm] = useState<null | "discard" | "save" | "save-conflict" | "promote">(null);

  const loadExperiment = useCallback(async (id: string) => {
    const e = await getExperimentAction({ experimentId: id });
    if (!e.success) return void toast.error(e.error);
    setExperiment(e.experiment);
    if (e.experiment.status !== "ACTIVE") return setWorkspace(null);
    const w = await loadStrategyWorkspaceAction({ strategyId: e.experiment.workingStrategyId });
    if (!w.success) return void toast.error(w.error);
    setWorkspace(w.data);
    setDataVersion((v) => v + 1);
  }, []);

  /** Switch what the panel edits: an experiment, or null = the read-only original. */
  const selectExperiment = useCallback(
    async (id: string | null) => {
      await flushPendingAutosaves();
      setExperimentId(id);
      if (!id) {
        setExperiment(null);
        setWorkspace(null);
        return;
      }
      await loadExperiment(id);
    },
    [loadExperiment],
  );

  const loadContext = useCallback(async () => {
    const r = await getTerminalStrategyContextAction({ accountId });
    if (!r.success) return void setLoadError(r.error);
    setContext(r.context);
    return r.context;
  }, [accountId]);

  useEffect(() => {
    let live = true;
    void getTerminalStrategyContextAction({ accountId }).then((r) => {
      if (!live) return;
      if (!r.success) return setLoadError(r.error);
      setContext(r.context);
      // Default: edit the session's own experiment while it's open.
      if (r.context.experiment?.status === "ACTIVE") void selectExperiment(r.context.experiment.id);
    });
    return () => {
      live = false;
    };
  }, [accountId, selectExperiment]);

  /** Save every pending edit, then reload data + change count. */
  const refresh = useCallback(async () => {
    await flushPendingAutosaves();
    if (experimentId) await loadExperiment(experimentId);
  }, [experimentId, loadExperiment]);

  const switchSection = (key: SectionKey) => {
    startTransition(async () => {
      // Sections share data (e.g. Setup types use Confluences): reload on switch.
      await refresh();
      setSection(key);
    });
  };

  const run = (fn: () => Promise<void>) => startTransition(fn);

  const fork = (fromExperimentId?: string) =>
    run(async () => {
      const baselineId = context?.baseline?.id;
      if (!baselineId) return;
      await flushPendingAutosaves();
      const r = await forkExperimentAction({ strategyId: baselineId, fromExperimentId: fromExperimentId ?? null });
      if (!r.success) return void toast.error(r.error);
      toast.success(`${r.experiment.label} started — the original strategy is untouched.`);
      await loadContext();
      await selectExperiment(r.experiment.id);
    });

  const build = () =>
    run(async () => {
      const r = await createBuildExperimentAction({ name: buildName });
      if (!r.success) return void toast.error(r.error);
      await loadContext();
      await selectExperiment(r.experiment.id);
    });

  const testOnSameConditions = (target: { experimentId: string } | { strategyId: string }) =>
    run(async () => {
      if (!(await flushPendingAutosaves())) return void toast.error("Some edits couldn't be saved — fix them first.");
      const r = await cloneSessionAction({ accountId, target });
      if (!r.success) return void toast.error(r.error);
      toast.success("New session created on the same data, period and costs.");
      onSessionCreated?.(r.accountId);
      router.push(`/backtesting/terminal/${r.accountId}`);
    });

  const save = (acceptBaselineChanges = false) =>
    run(async () => {
      if (!experiment) return;
      if (!(await flushPendingAutosaves())) return void toast.error("Some edits couldn't be saved — fix them first.");
      // The version note defaults to the experiment's name + hypothesis (its log).
      const r = await saveExperimentAsVersionAction({ experimentId: experiment.id, acceptBaselineChanges });
      if (!r.success) {
        if ("conflict" in r && r.conflict && !acceptBaselineChanges) return setConfirm("save-conflict");
        return void toast.error(r.error);
      }
      setConfirm(null);
      toast.success(
        r.preservedVersion
          ? `Published version ${r.publishedVersion}. The previous state was kept as version ${r.preservedVersion}.`
          : `Published version ${r.publishedVersion}.`,
      );
      await selectExperiment(null);
      await loadContext();
    });

  const promote = () =>
    run(async () => {
      if (!experiment) return;
      if (!(await flushPendingAutosaves())) return void toast.error("Some edits couldn't be saved — fix them first.");
      const r = await promoteExperimentAction({ experimentId: experiment.id, name: experiment.mode === "BUILD" ? null : experiment.name });
      if (!r.success) return void toast.error(r.error);
      setConfirm(null);
      toast.success(`"${r.name}" is now a Strategy Lab strategy.`);
      await selectExperiment(null);
      await loadContext();
    });

  const discard = () =>
    run(async () => {
      if (!experiment) return;
      const r = await discardExperimentAction({ experimentId: experiment.id });
      if (!r.success) return void toast.error(r.error);
      setConfirm(null);
      toast.success("Experiment discarded. The original strategy was never changed.");
      await selectExperiment(null);
      await loadContext();
    });

  if (loadError) return <p className="text-sm text-danger">{loadError}</p>;
  if (!context) {
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="size-4 animate-spin" /> Loading strategy…
      </div>
    );
  }

  const editing = experiment?.status === "ACTIVE" && workspace != null;
  const isSessionExperiment = experiment != null && context.session.experimentId === experiment.id;
  const changes = changeCount(experiment);

  return (
    <div className="flex min-h-0 flex-col gap-3 text-sm">
      {/* ── Header: what is being looked at / edited ───────────────────────── */}
      <div className="space-y-2 rounded-lg border border-border p-2.5">
        {experiment ? (
          <div className="space-y-1">
            <div className="flex flex-wrap items-center gap-1.5">
              <Badge variant="outline" className="gap-1 border-amber-500/50 text-amber-500">
                <FlaskConical className="size-3" /> {experiment.mode === "BUILD" ? "New strategy (draft)" : "Experiment"}
              </Badge>
              <span className="font-medium">{experiment.name}</span>
              {experiment.status !== "ACTIVE" && <Badge variant="outline">{experiment.status.replaceAll("_", " ").toLowerCase()}</Badge>}
            </div>
            {experiment.baseline && (
              <p className="text-xs text-muted-foreground">
                Baseline: <span className="text-foreground">{experiment.baseline.name}</span> (stays unchanged until you save){" · "}
                <button type="button" className="underline underline-offset-2" onClick={() => switchSection("changes")}>
                  {changes} change{changes === 1 ? "" : "s"}
                </button>
              </p>
            )}
            {experiment.baselineChangedSinceFork && (
              <p className="text-xs text-amber-500">The baseline was edited after this experiment started.</p>
            )}
          </div>
        ) : context.session.snapshot ? (
          <div className="flex flex-wrap items-center gap-1.5">
            <Badge variant="outline" className="gap-1">
              <Lock className="size-3" /> Original · read-only
            </Badge>
            <span className="font-medium">{context.session.strategyName}</span>
            {context.session.strategyVersion != null && <span className="text-xs text-muted-foreground">v{context.session.strategyVersion}</span>}
          </div>
        ) : (
          <p className="text-muted-foreground">This session has no structured strategy.</p>
        )}

        {/* Mode switching — nothing here ever discards work: experiments persist. */}
        <div className="flex flex-wrap items-center gap-1.5">
          {experimentId && (
            <Button size="xs" variant="ghost" onClick={() => run(() => selectExperiment(null))}>
              View original
            </Button>
          )}
          {context.baseline && (
            <Button size="xs" variant="outline" className="gap-1" disabled={pending} onClick={() => fork()}>
              <GitBranch className="size-3" /> New experiment
            </Button>
          )}
          {editing && experiment?.baseline && (
            <Button size="xs" variant="ghost" className="gap-1" disabled={pending} onClick={() => fork(experiment.id)} title="Branch a new variation from this experiment">
              <GitBranch className="size-3" /> Branch this
            </Button>
          )}
          {context.variations.length > 0 && (
            <select
              aria-label="Experiment to edit"
              value={experimentId ?? ""}
              onChange={(e) => {
                const next = e.target.value || null;
                run(() => selectExperiment(next));
              }}
              className="h-6 max-w-[12rem] rounded-md border border-border bg-background px-1.5 text-xs"
            >
              <option value="">Original (read-only)</option>
              {context.variations.map((v) => (
                <option key={v.id} value={v.id}>
                  {v.label} · {v.name}
                </option>
              ))}
            </select>
          )}
          {experiment && (
            <a href={`/backtesting/lab/experiments/${experiment.id}`} target="_blank" rel="noreferrer" className="text-xs text-muted-foreground underline underline-offset-2 hover:text-foreground">
              Compare results
            </a>
          )}
          {pending && <Loader2 className="size-3.5 animate-spin text-muted-foreground" />}
          {editing && (
            <Button size="icon-xs" variant="ghost" aria-label="Refresh" onClick={() => run(refresh)}>
              <RefreshCw className="size-3" />
            </Button>
          )}
        </div>

        {isSessionExperiment && editing && (
          <p className="rounded-md bg-muted/60 px-2 py-1.5 text-xs text-muted-foreground">
            This session&apos;s results stay tied to the configuration it started with. Your edits apply to new test sessions —
            use <em>Test on same conditions</em> to replay the same data with them.
          </p>
        )}
      </div>

      {/* ── No strategy: build one ─────────────────────────────────────────── */}
      {!experiment && !context.session.snapshot && (
        <form
          className="space-y-2 rounded-lg border border-dashed border-border p-3"
          onSubmit={(e) => {
            e.preventDefault();
            build();
          }}
        >
          <p className="flex items-center gap-1.5 font-medium">
            <Wand2 className="size-4" /> Build a strategy while you study the chart
          </p>
          <Input value={buildName} onChange={(e) => setBuildName(e.target.value)} placeholder="Strategy name" maxLength={120} required />
          <Button type="submit" size="sm" disabled={pending}>
            Start building
          </Button>
          <p className="text-xs text-muted-foreground">It stays a private draft until you create it as a Strategy Lab strategy.</p>
        </form>
      )}

      {/* ── Original: read-only frozen snapshot ────────────────────────────── */}
      {!experiment && context.session.snapshot && (
        <div className="space-y-2">
          <p className="text-xs text-muted-foreground">
            Frozen when this session was created. Start an experiment to change anything — the original never changes from here.
          </p>
          <StrategyVersionSnapshotView
            embedded
            strategyId={context.session.strategyId ?? ""}
            version={context.session.strategyVersion ?? 0}
            note={null}
            createdAt={new Date().toISOString()}
            snapshot={context.session.snapshot}
          />
        </div>
      )}

      {/* ── Closed experiment ──────────────────────────────────────────────── */}
      {experiment && experiment.status !== "ACTIVE" && (
        <p className="text-xs text-muted-foreground">
          This experiment is closed{experiment.resultVersion ? ` — it was published as version ${experiment.resultVersion}` : ""}. Its log stays editable.
        </p>
      )}

      {/* ── Editing an experiment ──────────────────────────────────────────── */}
      {experiment && (
        <>
          <nav aria-label="Strategy sections" className="-mx-1 flex gap-1 overflow-x-auto px-1 pb-1">
            {SECTIONS.filter((s) => editing || s.key === "log" || s.key === "changes").map((s) => (
              <button
                key={s.key}
                type="button"
                onClick={() => switchSection(s.key)}
                aria-current={section === s.key ? "page" : undefined}
                className={cn(
                  "shrink-0 rounded-md px-2 py-1 text-xs transition-colors",
                  section === s.key ? "bg-primary/15 font-medium text-foreground" : "text-muted-foreground hover:bg-muted",
                )}
              >
                {s.label}
                {s.key === "changes" && changes > 0 && <span className="ml-1 tabular-nums text-amber-500">{changes}</span>}
              </button>
            ))}
          </nav>

          <div className="min-h-0" key={`${experiment.id}-${dataVersion}`}>
            {editing && workspace && section === "framework" && <FrameworkSection strategyId={workspace.strategy.id} initialSteps={workspace.frameworkSteps} />}
            {editing && workspace && section === "entry" && <EntryModelsSection strategyId={workspace.strategy.id} initialModels={workspace.entryModels} />}
            {editing && workspace && section === "confluences" && (
              <StrategyChecklistSection strategyId={workspace.strategy.id} kind="CONFLUENCE" initialItems={workspace.confluences} />
            )}
            {editing && workspace && section === "execution" && (
              <StrategyChecklistSection strategyId={workspace.strategy.id} kind="EXECUTION" initialItems={workspace.execution} />
            )}
            {editing && workspace && section === "sessions" && <StrategySessionsSection strategyId={workspace.strategy.id} initialSessions={workspace.sessions} />}
            {editing && workspace && section === "setups" && (
              <SetupTypesSection
                strategyId={workspace.strategy.id}
                initialSetupTypes={workspace.setupTypes}
                availableConditions={[...workspace.confluences, ...workspace.execution]}
              />
            )}
            {editing && workspace && section === "management" && (
              <TradeManagementSection strategyId={workspace.strategy.id} tradeManagement={workspace.tradeManagement} liveExpectancy={NO_LIVE_STATS} />
            )}
            {editing && workspace && section === "timeframes" && <TimeframesSection strategyId={workspace.strategy.id} initialTimeframes={workspace.timeframes} />}
            {editing && workspace && section === "arsenal" && <ArsenalSection strategyId={workspace.strategy.id} initialConcepts={workspace.arsenalConcepts} />}
            {section === "log" && <ExperimentLog experiment={experiment} onSaved={() => experimentId && void loadExperiment(experimentId)} />}
            {section === "changes" &&
              (experiment.changesFromBaseline ? (
                <DiffView diff={experiment.changesFromBaseline} emptyText="No changes from the baseline yet." />
              ) : (
                <p className="text-xs text-muted-foreground">
                  {experiment.mode === "BUILD" ? "A new strategy has no baseline to compare with." : "Nothing to compare."}
                </p>
              ))}
          </div>

          {editing && (
            <div className="sticky bottom-0 -mx-3 space-y-1.5 border-t border-border bg-background/95 px-3 py-2 backdrop-blur">
              <div className="flex flex-wrap gap-1.5">
                <Button size="xs" variant="outline" className="gap-1" disabled={pending} onClick={() => testOnSameConditions({ experimentId: experiment.id })}>
                  <Play className="size-3" /> Test on same conditions
                </Button>
                {experiment.baseline && (
                  <Button size="xs" variant="ghost" className="gap-1" disabled={pending} onClick={() => testOnSameConditions({ strategyId: experiment.baseline!.id })}>
                    <Play className="size-3" /> Run baseline too
                  </Button>
                )}
              </div>
              <div className="flex flex-wrap gap-1.5">
                {experiment.mode === "REFINEMENT" && experiment.baseline && (
                  <Button size="xs" className="gap-1" disabled={pending} onClick={() => setConfirm("save")}>
                    <Save className="size-3" /> Save as new version
                  </Button>
                )}
                <Button size="xs" variant="outline" className="gap-1" disabled={pending} onClick={() => setConfirm("promote")}>
                  <Sparkles className="size-3" /> Create new strategy
                </Button>
                <Button size="xs" variant="ghost" className="gap-1 text-danger" disabled={pending} onClick={() => setConfirm("discard")}>
                  <Trash2 className="size-3" /> Discard
                </Button>
              </div>
            </div>
          )}
        </>
      )}

      <ConfirmDialog
        open={confirm === "discard"}
        onOpenChange={(o) => !o && setConfirm(null)}
        title="Discard this experiment?"
        description="Its working copy is archived. The original strategy was never changed, and sessions already run keep their results."
        confirmLabel="Discard"
        variant="destructive"
        isPending={pending}
        onConfirm={discard}
      />
      <ConfirmDialog
        open={confirm === "save"}
        onOpenChange={(o) => !o && setConfirm(null)}
        title={`Save as a new version of ${experiment?.baseline?.name ?? "the baseline"}?`}
        description={`Publishes this experiment's ${changes} change${changes === 1 ? "" : "s"} as a new version. Earlier versions are never modified; if the strategy has unpublished edits they are kept as their own version first.`}
        confirmLabel="Publish version"
        isPending={pending}
        onConfirm={() => save(false)}
      />
      <ConfirmDialog
        open={confirm === "save-conflict"}
        onOpenChange={(o) => !o && setConfirm(null)}
        title="The baseline changed after you started"
        description="Its current state will be published as its own version first (nothing is lost), then this experiment is published on top of it. Continue?"
        confirmLabel="Keep both and publish"
        isPending={pending}
        onConfirm={() => save(true)}
      />
      <ConfirmDialog
        open={confirm === "promote"}
        onOpenChange={(o) => !o && setConfirm(null)}
        title="Create a new Strategy Lab strategy?"
        description={`"${experiment?.mode === "BUILD" ? (workspace?.strategy.name ?? experiment?.name ?? "") : (experiment?.name ?? "")}" will appear in your strategy library as a draft. ${experiment?.baseline ? "The baseline stays as it is." : ""}`}
        confirmLabel="Create strategy"
        isPending={pending}
        onConfirm={promote}
      />
    </div>
  );
}

function ExperimentLog({ experiment, onSaved }: { experiment: StrategyExperimentDetailDTO; onSaved: () => void }) {
  const [draft, setDraft] = useState({
    name: experiment.name,
    hypothesis: experiment.hypothesis ?? "",
    expectedEffect: experiment.expectedEffect ?? "",
    actualOutcome: experiment.actualOutcome ?? "",
    notes: experiment.notes ?? "",
  });
  const [pending, startTransition] = useTransition();
  const dirty =
    draft.name !== experiment.name ||
    draft.hypothesis !== (experiment.hypothesis ?? "") ||
    draft.expectedEffect !== (experiment.expectedEffect ?? "") ||
    draft.actualOutcome !== (experiment.actualOutcome ?? "") ||
    draft.notes !== (experiment.notes ?? "");

  const field = (key: keyof typeof draft, label: string, placeholder: string) => (
    <label className="block space-y-1">
      <span className="text-xs text-muted-foreground">{label}</span>
      <Textarea rows={2} value={draft[key]} placeholder={placeholder} onChange={(e) => setDraft({ ...draft, [key]: e.target.value })} />
    </label>
  );

  return (
    <form
      className="space-y-2.5"
      onSubmit={(e) => {
        e.preventDefault();
        startTransition(async () => {
          const r = await updateExperimentLogAction({ experimentId: experiment.id, ...draft });
          if (!r.success) return void toast.error(r.error);
          toast.success("Experiment log saved.");
          onSaved();
        });
      }}
    >
      <label className="block space-y-1">
        <span className="text-xs text-muted-foreground">Name</span>
        <Input value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} maxLength={120} />
      </label>
      {field("hypothesis", "What changed, and why", "Losing trades often lacked displacement — require it.")}
      {field("expectedEffect", "Expected effect", "Fewer trades, higher win rate, similar expectancy.")}
      {field("actualOutcome", "Actual outcome", "Fill in after testing.")}
      {field("notes", "Notes & observations", "")}
      <p className="text-[11px] text-muted-foreground">
        Created {new Date(experiment.createdAt).toLocaleDateString()} · {experiment.sessionCount} test session{experiment.sessionCount === 1 ? "" : "s"}. Dataset,
        instrument, period and results of each session are shown on the experiment&apos;s comparison page.
      </p>
      <Button type="submit" size="sm" disabled={!dirty || pending}>
        {pending && <Loader2 className="animate-spin" />}
        Save log
      </Button>
    </form>
  );
}
