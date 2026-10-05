"use client";

import { useState } from "react";
import { toast } from "sonner";
import { ChevronDown, Plus } from "lucide-react";

import { Checkbox } from "@/components/ui/checkbox";
import { RichTextEditor } from "@/components/plan/rich-text-editor";
import { SaveDot } from "@/components/today/today-ui";
import type { SaveState } from "@/hooks/use-debounced-autosave";
import { updateTodaysPlan } from "@/actions/today.actions";
import { useDayRef } from "@/components/workspace/workspace-context";
import { tiptapToPlainText } from "@/lib/tiptap-text";
import type { TodaysPlanDTO } from "@/types/today";

function isEmptyDoc(doc: unknown) {
  return tiptapToPlainText(doc, 1).trim() === "";
}

/** An optional note editor that stays a one-line "Add …" link while empty. */
function OptionalNote({
  label,
  addLabel,
  initialContent,
  placeholder,
  onSave,
  readOnly,
}: {
  label: string;
  addLabel: string;
  initialContent: unknown;
  placeholder: string;
  onSave: (content: object) => ReturnType<typeof updateTodaysPlan>;
  readOnly: boolean;
}) {
  const [open, setOpen] = useState(!isEmptyDoc(initialContent));
  if (!open) {
    if (readOnly) return null;
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="flex items-center gap-1 text-xs text-muted-foreground transition-colors hover:text-foreground"
      >
        <Plus className="size-3.5" />
        {addLabel}
      </button>
    );
  }
  return (
    <div>
      <p className="mb-1.5 text-xs text-muted-foreground">{label}</p>
      <RichTextEditor initialContent={initialContent} placeholder={placeholder} onSave={onSave} editable={!readOnly} />
    </div>
  );
}

/**
 * Today V3 — Day Context (Plan UX pass). The two questions that change
 * trading behaviour are the page's main inputs: WHAT I'M LOOKING FOR (also
 * shown again at trade-decision time) and STAY OUT IF. Important conditions
 * and news/macro keep their columns and autosave unchanged, behind a quiet
 * "More context" disclosure that opens by itself when any of it has content.
 */
export function DayContext({ dateKey, plan, readOnly }: { dateKey: string; plan: TodaysPlanDTO; readOnly: boolean }) {
  const dayRef = useDayRef(dateKey);
  const [newsAcknowledged, setNewsAcknowledged] = useState(plan.newsAcknowledged);
  const [newsSave, setNewsSave] = useState<SaveState>("idle");
  const extras = [
    !isEmptyDoc(plan.importantConditions) && "conditions",
    plan.newsAcknowledged && "news reviewed",
    !isEmptyDoc(plan.newsNotes) && "news notes",
    !isEmptyDoc(plan.dailyFundamentalOutlook) && "macro",
  ].filter(Boolean) as string[];
  const [moreOpen, setMoreOpen] = useState(extras.length > 0 && extras.some((e) => e !== "news reviewed"));

  async function toggleNews(checked: boolean) {
    setNewsAcknowledged(checked);
    setNewsSave("saving");
    const r = await updateTodaysPlan(dayRef, { newsAcknowledged: checked });
    if (r.success) setNewsSave("saved");
    else {
      setNewsSave("error");
      toast.error(r.error);
    }
  }

  return (
    <div className="space-y-4">
      <div className="grid gap-6 lg:grid-cols-2">
        <section aria-label="What I'm looking for" className="space-y-2">
          <h3 className="font-mono text-[11px] font-semibold tracking-wider text-foreground uppercase">What I&apos;m looking for</h3>
          <RichTextEditor
            initialContent={plan.lookingFor}
            placeholder="e.g. Sweep of the Asia low into NY open, then a reversal into the daily FVG…"
            onSave={(content) => updateTodaysPlan(dayRef, { lookingFor: content })}
            editable={!readOnly}
          />
        </section>
        <section aria-label="Stay out if" className="space-y-2">
          <h3 className="font-mono text-[11px] font-semibold tracking-wider text-warning uppercase">Stay out if</h3>
          <RichTextEditor
            initialContent={plan.stayOutConditions}
            placeholder="e.g. No clean structure by London close, red-folder news window, choppy range…"
            onSave={(content) => updateTodaysPlan(dayRef, { stayOutConditions: content })}
            editable={!readOnly}
          />
        </section>
      </div>

      <div>
        <button
          type="button"
          onClick={() => setMoreOpen((v) => !v)}
          aria-expanded={moreOpen}
          className="flex items-center gap-1 text-xs text-muted-foreground transition-colors hover:text-foreground"
        >
          <ChevronDown className={moreOpen ? "size-3.5 rotate-180 transition-transform" : "size-3.5 transition-transform"} />
          More context
          {extras.length > 0 && !moreOpen && <span className="text-muted-foreground/70">· {extras.join(" · ")}</span>}
        </button>
        {moreOpen && (
          <div className="mt-3 space-y-4 border-l border-border/60 pl-4">
            <div>
              <p className="mb-1.5 text-xs text-muted-foreground">Important conditions</p>
              <RichTextEditor
                initialContent={plan.importantConditions}
                placeholder="Volatility, correlated markets, illiquid holiday session…"
                onSave={(content) => updateTodaysPlan(dayRef, { importantConditions: content })}
                editable={!readOnly}
              />
            </div>
            <label className="flex items-center gap-2.5 text-sm">
              <Checkbox checked={newsAcknowledged} onCheckedChange={(c) => toggleNews(c === true)} disabled={readOnly} />
              I&apos;ve reviewed today&apos;s relevant news/economic events
              <SaveDot state={newsSave} />
            </label>
            <OptionalNote
              label="News notes"
              addLabel="Add news notes"
              initialContent={plan.newsNotes}
              placeholder="Events to watch — time, currency/market, expected impact…"
              onSave={(content) => updateTodaysPlan(dayRef, { newsNotes: content })}
              readOnly={readOnly}
            />
            <OptionalNote
              label="General macro/fundamental outlook"
              addLabel="Add macro outlook"
              initialContent={plan.dailyFundamentalOutlook}
              placeholder="Overall macro backdrop for the day — general, not per-asset…"
              onSave={(content) => updateTodaysPlan(dayRef, { dailyFundamentalOutlook: content })}
              readOnly={readOnly}
            />
          </div>
        )}
      </div>
    </div>
  );
}
