"use client";

import { useEffect, useState, useTransition } from "react";
import { toast } from "sonner";
import { AlertTriangle, Bot, Loader2, RefreshCw, Sparkles } from "lucide-react";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/shared/empty-state";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { generateReviewAnalysisAction, getLatestReviewAnalysisAction } from "@/actions/ai-review-analyst.actions";
import type { AnalystFinding, EvidenceItem, EvidenceStrength } from "@/domain/ai-review/types";
import type { PersistedAnalystReportDTO } from "@/server/services/ai-review-analyst.service";

const CONFIDENCE_CLASS: Record<string, string> = {
  HIGH: "bg-success/15 text-success",
  MEDIUM: "bg-warning/15 text-warning",
  LOW: "bg-secondary text-secondary-foreground",
};

const STRENGTH_LABEL: Record<EvidenceStrength, string> = {
  OBJECTIVE: "Objective",
  DERIVED: "Derived",
  TRADER_REPORTED: "Trader-reported",
};

const STRENGTH_CLASS: Record<EvidenceStrength, string> = {
  OBJECTIVE: "border-success/30 bg-success/5 text-success",
  DERIVED: "border-primary/30 bg-primary/5 text-primary",
  TRADER_REPORTED: "border-warning/30 bg-warning/5 text-warning",
};

/**
 * Edge → Analyst (Stage 20) — the first AI experience in Traditorium,
 * deliberately shaped like a structured analyst report rather than a
 * chatbot (§45): confidence-badged findings, evidence-linked citations,
 * a clear generation timestamp. Complements — never replaces — Comparison/
 * Improvements/Analytics (§49): everything here traces back to evidence
 * the trader can inspect deterministically elsewhere. Generation is always
 * an explicit action (§47/§48) — this never spends a model call on mount.
 */
export function EdgeAnalystPanel({ sessionId, finalized }: { sessionId: string | null; finalized: boolean }) {
  const [report, setReport] = useState<PersistedAnalystReportDTO | null | undefined>(undefined);
  const [pending, startTransition] = useTransition();
  const [evidenceOpen, setEvidenceOpen] = useState<EvidenceItem | null>(null);

  useEffect(() => {
    if (!sessionId || !finalized) return;
    let cancelled = false;
    void getLatestReviewAnalysisAction(sessionId).then((result) => {
      if (!cancelled) setReport(result);
    });
    return () => {
      cancelled = true;
    };
  }, [sessionId, finalized]);

  if (!sessionId || !finalized) {
    return (
      <EmptyState
        icon={Bot}
        title="Finish this review to unlock AI analysis"
        description="The Analyst reviews a finalized period's evidence — complete Replay and Finish Review in Improvements first."
      />
    );
  }

  function generate() {
    if (!sessionId) return;
    startTransition(async () => {
      const result = await generateReviewAnalysisAction(sessionId);
      if (!result.success) {
        toast.error(result.error);
        return;
      }
      setReport(result.report);
      toast.success("Analysis generated.");
    });
  }

  const evidenceIndex = report?.evidenceIndex ?? {};

  function openEvidence(id: string) {
    const item = evidenceIndex[id];
    if (item) setEvidenceOpen(item);
  }

  return (
    <div className="space-y-4">
      <div className="glass flex flex-wrap items-center justify-between gap-3 rounded-2xl p-4">
        <div className="flex items-center gap-2">
          <Sparkles className="size-4 text-primary" />
          <div>
            <h3 className="text-sm font-semibold">Traditorium Review Analyst</h3>
            <p className="text-xs text-muted-foreground">Analyzes your process — never predicts the market or generates trade signals.</p>
          </div>
        </div>
        <Button type="button" size="sm" className="gap-1.5" disabled={pending} onClick={generate}>
          {pending && <Loader2 className="size-3.5 animate-spin" />}
          {report ? <RefreshCw className="size-3.5" /> : <Sparkles className="size-3.5" />}
          {report ? "Regenerate" : "Generate Review Analysis"}
        </Button>
      </div>

      {report === undefined && (
        <div className="flex items-center justify-center gap-1.5 py-10 text-xs text-muted-foreground">
          <Loader2 className="size-3.5 animate-spin" /> Loading…
        </div>
      )}

      {report === null && (
        <EmptyState
          icon={Sparkles}
          title="No analysis generated yet"
          description="Generate a structured, evidence-cited analysis of this period's process — planning, execution, behavior, and improvement progress."
        />
      )}

      {report && (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
            <span>Generated {new Date(report.generatedAt).toLocaleString()}</span>
            <span>·</span>
            <span>
              {report.provider} / {report.model}
            </span>
            <span>·</span>
            <span>
              {report.report.evidenceCoverage.citedEvidenceItems}/{report.report.evidenceCoverage.totalEvidenceItems} evidence items cited
            </span>
            {report.stale && (
              <span className="flex items-center gap-1 rounded bg-warning/15 px-1.5 py-0.5 font-medium text-warning">
                <AlertTriangle className="size-3" /> Evidence has changed since this was generated
              </span>
            )}
          </div>

          <ReportSection title="Period Summary">
            <p className="text-sm text-muted-foreground">{report.report.periodSummary}</p>
          </ReportSection>

          <FindingsSection title="What You Did Well" findings={report.report.strengths} onCite={openEvidence} tone="success" />
          <FindingsSection title="What Hurt Your Process" findings={report.report.concerns} onCite={openEvidence} tone="danger" />
          <FindingsSection title="Improvement Progress" findings={report.report.improvementProgress} onCite={openEvidence} />
          <FindingsSection title="Patterns Worth Watching" findings={report.report.recurringPatterns} onCite={openEvidence} />
          <FindingsSection title="Priority for Next Period" findings={report.report.priorityFocus} onCite={openEvidence} tone="primary" />

          {report.report.questionsForReflection.length > 0 && (
            <ReportSection title="Questions for Reflection">
              <ul className="space-y-1.5">
                {report.report.questionsForReflection.map((q, i) => (
                  <li key={i} className="flex items-start gap-2 text-sm">
                    <span className="mt-0.5 text-muted-foreground/50">?</span>
                    <div>
                      <span>{q.question}</span>
                      {q.relatedEvidenceIds.length > 0 && (
                        <div className="mt-1 flex flex-wrap gap-1">
                          {q.relatedEvidenceIds.map((id) => (
                            <EvidenceChip key={id} id={id} onClick={openEvidence} />
                          ))}
                        </div>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            </ReportSection>
          )}
        </div>
      )}

      <Sheet open={evidenceOpen != null} onOpenChange={(open) => !open && setEvidenceOpen(null)}>
        <SheetContent side="right" className="w-full p-4 sm:max-w-md">
          <SheetHeader className="p-0">
            <SheetTitle>Evidence</SheetTitle>
          </SheetHeader>
          {evidenceOpen && (
            <div className="mt-4 space-y-2">
              <span className={cn("inline-block rounded border px-2 py-0.5 text-[10px] font-medium", STRENGTH_CLASS[evidenceOpen.strength])}>
                {STRENGTH_LABEL[evidenceOpen.strength]}
              </span>
              <p className="text-xs text-muted-foreground">{evidenceOpen.category}</p>
              <p className="text-sm">{evidenceOpen.statement}</p>
              {evidenceOpen.dateKey && <p className="text-xs text-muted-foreground/70">{evidenceOpen.dateKey}</p>}
            </div>
          )}
        </SheetContent>
      </Sheet>
    </div>
  );
}

function ReportSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="glass space-y-2 rounded-2xl p-4">
      <h4 className="text-sm font-semibold">{title}</h4>
      {children}
    </div>
  );
}

function EvidenceChip({ id, onClick }: { id: string; onClick: (id: string) => void }) {
  return (
    <button
      type="button"
      onClick={() => onClick(id)}
      className="rounded border border-border/60 bg-background/60 px-1.5 py-0.5 text-[10px] text-muted-foreground hover:border-primary/50 hover:text-primary"
    >
      {id}
    </button>
  );
}

function FindingsSection({
  title,
  findings,
  onCite,
  tone,
}: {
  title: string;
  findings: AnalystFinding[];
  onCite: (id: string) => void;
  tone?: "success" | "danger" | "primary";
}) {
  if (findings.length === 0) return null;
  return (
    <ReportSection title={title}>
      <div className="space-y-2">
        {findings.map((f, i) => (
          <div
            key={i}
            className={cn(
              "space-y-1 rounded-lg border p-2.5 text-xs",
              tone === "success" && "border-success/30 bg-success/5",
              tone === "danger" && "border-danger/30 bg-danger/5",
              tone === "primary" && "border-primary/30 bg-primary/5",
              !tone && "border-border/60 bg-background/40",
            )}
          >
            <div className="flex items-center justify-between gap-2">
              <p className="font-medium">{f.title}</p>
              <span className={cn("shrink-0 rounded px-1.5 py-0.5 text-[10px] font-medium", CONFIDENCE_CLASS[f.confidence])}>{f.confidence}</span>
            </div>
            <p className="text-muted-foreground">{f.explanation}</p>
            <div className="flex flex-wrap items-center gap-1 pt-0.5">
              <span className="rounded bg-secondary px-1 text-[9px] text-secondary-foreground">{f.category}</span>
              {f.evidenceIds.map((id) => (
                <EvidenceChip key={id} id={id} onClick={onCite} />
              ))}
            </div>
          </div>
        ))}
      </div>
    </ReportSection>
  );
}
