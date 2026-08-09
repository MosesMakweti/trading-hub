import Link from "next/link";
import { ChevronLeft } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Tag } from "@/components/ui/tag";
import { StrategyStatusBadge } from "@/components/strategy-lab/strategy-status-badge";
import { tiptapToPlainText } from "@/lib/tiptap-text";
import { minutesToTimeString } from "@/lib/date";
import type {
  StrategyVersionConfluenceSnapshot,
  StrategyVersionSnapshot,
} from "@/types/strategies";

const FULL = 100_000; // effectively no truncation for the full read-only view

function text(value: unknown): string {
  return tiptapToPlainText(value, FULL).trim();
}

/** A labelled rich-text field rendered as read-only plain text; hidden when empty. */
function Field({ label, value }: { label: string; value: unknown }) {
  const body = text(value);
  if (!body) return null;
  return (
    <div className="space-y-0.5">
      <div className="text-xs text-muted-foreground">{label}</div>
      <p className="text-sm whitespace-pre-wrap">{body}</p>
    </div>
  );
}

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="glass space-y-2 rounded-2xl p-4">
      <h3 className="font-medium">{title}</h3>
      {children}
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-2">
      <h2 className="text-sm font-semibold tracking-tight text-muted-foreground">{title}</h2>
      {children}
    </section>
  );
}

const ARSENAL_FIELDS = [
  ["definition", "Definition"],
  ["purpose", "Purpose"],
  ["howIIdentify", "How I identify it"],
  ["whyItMatters", "Why it matters"],
  ["whenIUse", "When I use it"],
  ["whenIIgnore", "When I ignore it"],
  ["examples", "Examples"],
  ["personalNotes", "Personal notes"],
] as const;

const ENTRY_FIELDS = [
  ["description", "Description"],
  ["conditions", "Conditions"],
  ["confirmationChecklist", "Confirmation checklist"],
  ["invalidation", "Invalidation"],
  ["stopPlacement", "Stop placement"],
  ["targetLogic", "Target logic"],
  ["notes", "Notes"],
] as const;

const TM_FIELDS = [
  ["takeProfitPhilosophy", "Take-profit philosophy"],
  ["initialStopPlacement", "Initial stop placement"],
  ["breakEvenRules", "Break-even rules"],
  ["trailingStopRules", "Trailing-stop rules"],
  ["scalingInRules", "Scaling-in rules"],
  ["scalingOutRules", "Scaling-out rules"],
] as const;

/** Read-only colored list of frozen confluences / execution confirmations. */
function ChecklistCard({
  title,
  items,
}: {
  title: string;
  items: StrategyVersionConfluenceSnapshot[];
}) {
  return (
    <Card title={title}>
      <div className="space-y-1.5">
        {items.map((c) => (
          <div key={c.name} className="flex flex-wrap items-center gap-2">
            <Tag color={c.color} muted={!c.enabled}>
              {c.name}
            </Tag>
            {c.mandatory && (
              <span className="rounded-full border border-warning/30 bg-warning/10 px-1.5 py-0.5 text-[10px] font-medium text-warning">
                Core
              </span>
            )}
            {c.weight != null && (
              <span className="text-xs text-muted-foreground tabular-nums">w{c.weight}</span>
            )}
            {c.category && <span className="text-xs text-muted-foreground">{c.category}</span>}
          </div>
        ))}
      </div>
    </Card>
  );
}

export function StrategyVersionSnapshotView({
  strategyId,
  version,
  note,
  createdAt,
  snapshot,
}: {
  strategyId: string;
  version: number;
  note: string | null;
  createdAt: string;
  snapshot: StrategyVersionSnapshot;
}) {
  const s = snapshot;
  const tm = s.tradeManagement;
  const sessions = s.sessions ?? [];
  const confluences = s.confluences ?? [];
  const execution = s.execution ?? [];

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div className="flex items-start gap-2">
        <Link
          href={`/strategy-lab/${strategyId}`}
          aria-label="Back to strategy"
          className="mt-1 inline-flex size-7 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"
        >
          <ChevronLeft className="size-4" />
        </Link>
        <div className="min-w-0 space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-xl font-semibold tracking-tight">{s.name}</h1>
            <Badge variant="outline" className="tabular-nums">
              Version {version}
            </Badge>
            <StrategyStatusBadge status={s.status} />
          </div>
          <p className="text-xs text-muted-foreground">
            Read-only snapshot · published {new Date(createdAt).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })}
          </p>
          {note && <p className="text-sm">{note}</p>}
        </div>
      </div>

      {(s.description || s.applicableAssets.length > 0) && (
        <Card title="Overview">
          {s.description && <p className="text-sm whitespace-pre-wrap">{s.description}</p>}
          {s.applicableAssets.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {s.applicableAssets.map((a) => (
                <Badge key={a} variant="outline">
                  {a}
                </Badge>
              ))}
            </div>
          )}
        </Card>
      )}

      {sessions.length > 0 && (
        <Card title="Trading sessions">
          <div className="flex flex-wrap gap-1.5">
            {sessions.map((sess) => (
              <Tag key={sess.name} color={sess.color} muted={!sess.enabled}>
                {sess.name}
                {sess.startMinutes != null && sess.endMinutes != null && (
                  <span className="ml-1 opacity-70 tabular-nums">
                    {minutesToTimeString(sess.startMinutes)}–{minutesToTimeString(sess.endMinutes)}
                  </span>
                )}
              </Tag>
            ))}
          </div>
        </Card>
      )}

      {confluences.length > 0 && (
        <Section title="Confluences">
          <ChecklistCard title="Confluences" items={confluences} />
        </Section>
      )}

      {execution.length > 0 && (
        <Section title="Execution confirmations">
          <ChecklistCard title="Execution confirmations" items={execution} />
        </Section>
      )}

      {s.arsenalConcepts.length > 0 && (
        <Section title="Arsenal">
          {s.arsenalConcepts.map((c) => (
            <Card key={c.id} title={c.name}>
              {ARSENAL_FIELDS.map(([key, label]) => (
                <Field key={key} label={label} value={c[key]} />
              ))}
            </Card>
          ))}
        </Section>
      )}

      {s.frameworkSteps.length > 0 && (
        <Section title="Framework">
          <ol className="space-y-2">
            {s.frameworkSteps.map((step, i) => (
              <li key={step.id} className="glass space-y-1 rounded-2xl p-4">
                <h3 className="font-medium">
                  <span className="text-muted-foreground tabular-nums">{i + 1}.</span> {step.title}
                </h3>
                <Field label="Description" value={step.description} />
                <Field label="Notes" value={step.notes} />
              </li>
            ))}
          </ol>
        </Section>
      )}

      {s.timeframes.length > 0 && (
        <Section title="Timeframes">
          {s.timeframes.map((tf) => (
            <Card key={tf.id} title={tf.name}>
              {tf.checkpoints.length === 0 ? (
                <p className="text-xs text-muted-foreground/50 italic">No checkpoints.</p>
              ) : (
                <ul className="space-y-2">
                  {tf.checkpoints.map((cp) => (
                    <li key={cp.id} className="rounded-lg border border-border bg-background/40 p-2">
                      <div className="text-sm font-medium">{cp.title}</div>
                      <Field label="Description" value={cp.description} />
                      <Field label="Notes" value={cp.notes} />
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          ))}
        </Section>
      )}

      {s.entryModels.length > 0 && (
        <Section title="Entry models">
          {s.entryModels.map((m) => (
            <Card key={m.id} title={m.name}>
              {ENTRY_FIELDS.map(([key, label]) => (
                <Field key={key} label={label} value={m[key]} />
              ))}
            </Card>
          ))}
        </Section>
      )}

      {tm && (
        <Section title="Trade management">
          <Card title="Rules">
            {TM_FIELDS.map(([key, label]) => (
              <Field key={key} label={label} value={tm[key]} />
            ))}
            <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
              {tm.maxRiskPercent != null && (
                <span>
                  Max risk: <span className="text-foreground tabular-nums">{tm.maxRiskPercent}%</span>
                </span>
              )}
              {tm.maxHoldingTime && (
                <span>
                  Max hold: <span className="text-foreground">{tm.maxHoldingTime}</span>
                </span>
              )}
            </div>
            {tm.partialTakeProfits.length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {tm.partialTakeProfits.map((p) => (
                  <Badge key={p.id} variant="secondary">
                    {p.trigger ?? "TP"}
                    {p.percentToClose != null ? ` · ${p.percentToClose}%` : ""}
                  </Badge>
                ))}
              </div>
            )}
            {tm.customRules.length > 0 && (
              <ul className="ml-4 list-disc space-y-0.5 text-sm marker:text-muted-foreground">
                {tm.customRules.map((r) => (
                  <li key={r.id}>{r.text}</li>
                ))}
              </ul>
            )}
          </Card>
        </Section>
      )}
    </div>
  );
}
