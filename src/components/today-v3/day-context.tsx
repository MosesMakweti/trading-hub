"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Plus } from "lucide-react";

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

function Group({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) {
  return (
    <section className="grid gap-2 sm:grid-cols-[150px_minmax(0,1fr)]">
      <div>
        <h4 className="text-sm font-medium">{title}</h4>
        {hint && <p className="text-[11px] text-muted-foreground">{hint}</p>}
      </div>
      <div className="min-w-0 space-y-3">{children}</div>
    </section>
  );
}

/**
 * Today V3 — Day Context. The same TradingDay fields as before, regrouped:
 * intent first (lookingFor — later shown at trade-decision time), then
 * Conditions (important + stay-out, two fields), then News & macro (the
 * explicit acknowledgement plus two optional notes). Everything autosaves
 * exactly as the V2 section did; legacy bias/conviction/keyLevels/watchlist
 * get no input here (still readable in the Journal).
 */
export function DayContext({ dateKey, plan, readOnly }: { dateKey: string; plan: TodaysPlanDTO; readOnly: boolean }) {
  const dayRef = useDayRef(dateKey);
  const [newsAcknowledged, setNewsAcknowledged] = useState(plan.newsAcknowledged);
  const [newsSave, setNewsSave] = useState<SaveState>("idle");

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
    <div className="space-y-5">
      <Group title="Looking for" hint="Shown again when you take a trade">
        <RichTextEditor
          initialContent={plan.lookingFor}
          placeholder="What am I looking for today? e.g. Liquidity sweep of the Asia low into NY open, then a reversal…"
          onSave={(content) => updateTodaysPlan(dayRef, { lookingFor: content })}
          editable={!readOnly}
        />
      </Group>

      <Group title="Conditions">
        <div className="grid gap-3 lg:grid-cols-2">
          <div>
            <p className="mb-1.5 text-xs text-muted-foreground">Important conditions</p>
            <RichTextEditor
              initialContent={plan.importantConditions}
              placeholder="Volatility, correlated markets, illiquid holiday session…"
              onSave={(content) => updateTodaysPlan(dayRef, { importantConditions: content })}
              editable={!readOnly}
            />
          </div>
          <div className="rounded-lg border border-warning/30 bg-warning/5 p-2">
            <p className="mb-1.5 text-xs font-medium text-warning">Stay-out conditions</p>
            <RichTextEditor
              initialContent={plan.stayOutConditions}
              placeholder="What means staying flat today — no clear structure, red-folder news window, choppy range…"
              onSave={(content) => updateTodaysPlan(dayRef, { stayOutConditions: content })}
              editable={!readOnly}
            />
          </div>
        </div>
      </Group>

      <Group title="News & macro">
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
      </Group>
    </div>
  );
}
