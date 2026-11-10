"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { toast } from "sonner";
import { ChevronDown, Plus } from "lucide-react";

import { Checkbox } from "@/components/ui/checkbox";
import { ImageAttachments } from "@/components/media/image-attachments";
import { loadMediaAction } from "@/actions/media.actions";
import type { MediaItemDTO } from "@/server/services/media.service";
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

/** Plan image sections — the MediaAttachment category on the TradingDay. */
type PlanImageSection = "LOOKING_FOR" | "STAY_OUT" | "CONDITIONS" | "NEWS" | "MACRO";

interface PlanMedia {
  dayId: string;
  uploadsEnabled: boolean;
  items: MediaItemDTO[];
}

/** The day's plan images, loaded once for every section (null while loading). */
function usePlanMedia(dayId: string): PlanMedia | null {
  const [media, setMedia] = useState<PlanMedia | null>(null);
  useEffect(() => {
    let active = true;
    void loadMediaAction("TRADING_DAY", dayId).then((r) => {
      if (active) setMedia({ dayId, ...r });
    });
    return () => {
      active = false;
    };
  }, [dayId]);
  return media?.dayId === dayId ? media : null;
}

/**
 * A plan note with its own images: the editor, then a compact gallery. A
 * copied image pasted into the note (Ctrl/Cmd+V) is uploaded to this
 * section's gallery; pasted text still goes into the note as usual.
 */
function NoteWithImages({
  section,
  media,
  readOnly,
  children,
}: {
  section: PlanImageSection;
  media: PlanMedia | null;
  readOnly: boolean;
  children: ReactNode;
}) {
  const zoneRef = useRef<HTMLDivElement>(null);
  return (
    <div className="space-y-1.5">
      <div ref={zoneRef}>{children}</div>
      {media && (
        <ImageAttachments
          key={media.dayId}
          ownerType="TRADING_DAY"
          ownerId={media.dayId}
          category={section}
          initial={media.items.filter((i) => i.category === section)}
          uploadsEnabled={media.uploadsEnabled}
          disabled={readOnly}
          compact
          pasteZoneRef={zoneRef}
        />
      )}
    </div>
  );
}

/** An optional note editor that stays a one-line "Add …" link while empty. */
function OptionalNote({
  label,
  addLabel,
  initialContent,
  placeholder,
  onSave,
  readOnly,
  section,
  media,
}: {
  label: string;
  addLabel: string;
  initialContent: unknown;
  placeholder: string;
  onSave: (content: object) => ReturnType<typeof updateTodaysPlan>;
  readOnly: boolean;
  section: PlanImageSection;
  media: PlanMedia | null;
}) {
  const [opened, setOpen] = useState(!isEmptyDoc(initialContent));
  const open = opened || Boolean(media?.items.some((i) => i.category === section));
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
      <NoteWithImages section={section} media={media} readOnly={readOnly}>
        <RichTextEditor initialContent={initialContent} placeholder={placeholder} onSave={onSave} editable={!readOnly} />
      </NoteWithImages>
    </div>
  );
}

/**
 * Today V3 — Day Context (Plan UX pass). The two questions that change
 * trading behaviour are the page's main inputs: WHAT I'M LOOKING FOR (also
 * shown again at trade-decision time) and STAY OUT IF. Important conditions
 * and news/macro keep their columns and autosave unchanged, behind a quiet
 * "More context" disclosure that opens by itself when any of it has content.
 * Every note can carry screenshots (TRADING_DAY media, one category per
 * section) — added from a small link under it or pasted straight into it.
 */
export function DayContext({ dateKey, plan, readOnly }: { dateKey: string; plan: TodaysPlanDTO; readOnly: boolean }) {
  const dayRef = useDayRef(dateKey);
  const media = usePlanMedia(plan.tradingDayId);
  const [newsAcknowledged, setNewsAcknowledged] = useState(plan.newsAcknowledged);
  const [newsSave, setNewsSave] = useState<SaveState>("idle");
  const extras = [
    !isEmptyDoc(plan.importantConditions) && "conditions",
    plan.newsAcknowledged && "news reviewed",
    !isEmptyDoc(plan.newsNotes) && "news notes",
    !isEmptyDoc(plan.dailyFundamentalOutlook) && "macro",
  ].filter(Boolean) as string[];
  const moreImages = media?.items.filter((i) => ["CONDITIONS", "NEWS", "MACRO"].includes(i.category ?? "")).length ?? 0;
  if (moreImages > 0) extras.push(`${moreImages} image${moreImages === 1 ? "" : "s"}`);
  const [moreToggled, setMoreOpen] = useState<boolean | null>(null);
  const moreOpen = moreToggled ?? extras.some((e) => e !== "news reviewed");

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
          <NoteWithImages section="LOOKING_FOR" media={media} readOnly={readOnly}>
            <RichTextEditor
              initialContent={plan.lookingFor}
              placeholder="e.g. Sweep of the Asia low into NY open, then a reversal into the daily FVG…"
              onSave={(content) => updateTodaysPlan(dayRef, { lookingFor: content })}
              editable={!readOnly}
            />
          </NoteWithImages>
        </section>
        <section aria-label="Stay out if" className="space-y-2">
          <h3 className="font-mono text-[11px] font-semibold tracking-wider text-warning uppercase">Stay out if</h3>
          <NoteWithImages section="STAY_OUT" media={media} readOnly={readOnly}>
            <RichTextEditor
              initialContent={plan.stayOutConditions}
              placeholder="e.g. No clean structure by London close, red-folder news window, choppy range…"
              onSave={(content) => updateTodaysPlan(dayRef, { stayOutConditions: content })}
              editable={!readOnly}
            />
          </NoteWithImages>
        </section>
      </div>

      <div>
        <button
          type="button"
          onClick={() => setMoreOpen(!moreOpen)}
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
              <NoteWithImages section="CONDITIONS" media={media} readOnly={readOnly}>
                <RichTextEditor
                  initialContent={plan.importantConditions}
                  placeholder="Volatility, correlated markets, illiquid holiday session…"
                  onSave={(content) => updateTodaysPlan(dayRef, { importantConditions: content })}
                  editable={!readOnly}
                />
              </NoteWithImages>
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
              section="NEWS"
              media={media}
            />
            <OptionalNote
              label="General macro/fundamental outlook"
              addLabel="Add macro outlook"
              initialContent={plan.dailyFundamentalOutlook}
              placeholder="Overall macro backdrop for the day — general, not per-asset…"
              onSave={(content) => updateTodaysPlan(dayRef, { dailyFundamentalOutlook: content })}
              readOnly={readOnly}
              section="MACRO"
              media={media}
            />
          </div>
        )}
      </div>
    </div>
  );
}
