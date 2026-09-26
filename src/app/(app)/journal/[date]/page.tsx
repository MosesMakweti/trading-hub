import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronLeft, ChevronRight, Plus } from "lucide-react";

import { requireUser } from "@/server/guards";
import { getOrCreateDailyNote } from "@/server/services/journal.service";
import { loadJournalDay } from "@/server/services/journal-day-view.service";
import { ImageAttachments } from "@/components/media/image-attachments";
import { addDaysToKey, formatDateKeyLong, isValidDateKey, localDateToKey } from "@/lib/date";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { DailyNoteEditor } from "@/components/journal/daily-note-editor";
import { TodayLiveCallout } from "@/components/journal/today-live-callout";
import { ReadOnlyDayBanner } from "@/components/journal/read-only-day-banner";
import { JournalDayActivity, JournalDayRecord } from "@/components/journal/day/journal-day-history";
import { FadeIn } from "@/components/shared/motion";

/**
 * Journal Day view (Stage 9) — the historical record of a Trading Day: an
 * overview (Stage 8's getDayCloseSummary), the frozen Daily Outlook (Stage
 * 1) and Asset Analysis (Stage 2), the day's reflection + behaviour recap
 * (Stage 8/7), and every trade taken. Read-only by default — editing is the
 * exception (a carried-open trade's own execution/review fields; see
 * TradeWorkspace/isTradeWorkspaceEditable), never a live operating surface.
 * `isToday` still hands off to Today (TodayLiveCallout) — the live workflow
 * has never belonged here, and Stage 9 doesn't change that.
 */
export default async function JournalDayPage({
  params,
}: {
  params: Promise<{ date: string }>;
}) {
  const { date: dateKey } = await params;
  if (!isValidDateKey(dateKey)) notFound();

  const user = await requireUser();
  const isToday = dateKey === localDateToKey(new Date());
  // Shared with the Backtesting Journal (journal-day-view.service.ts). The
  // daily note is live-Journal-only.
  const [note, data] = await Promise.all([
    getOrCreateDailyNote(user.id, dateKey),
    loadJournalDay(user.id, dateKey, { historical: !isToday }),
  ]);
  const { recap } = data;

  const prevKey = addDaysToKey(dateKey, -1);
  const nextKey = addDaysToKey(dateKey, 1);
  // Archived days are read-only until reopened (null recap = never opened = editable).
  const editable = recap?.status !== "ARCHIVED";

  return (
    <FadeIn className="mx-auto max-w-4xl space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="Previous day"
            nativeButton={false}
            render={<Link href={`/journal/${prevKey}`} />}
          >
            <ChevronLeft />
          </Button>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-xl font-semibold tracking-tight">
                {formatDateKeyLong(dateKey)}
              </h1>
              {recap && (
                <Badge variant={recap.status === "ARCHIVED" ? "secondary" : "success"}>
                  {recap.status === "ARCHIVED" ? "Archived" : "Active"}
                </Badge>
              )}
            </div>
            {isToday && <p className="text-xs text-primary">Today</p>}
          </div>
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="Next day"
            nativeButton={false}
            render={<Link href={`/journal/${nextKey}`} />}
          >
            <ChevronRight />
          </Button>
        </div>
        <Button variant="outline" size="sm" nativeButton={false} render={<Link href="/journal" />}>
          Back to calendar
        </Button>
      </div>

      {!editable && <ReadOnlyDayBanner dateKey={dateKey} />}

      {/* Today's live routine/plan/workflow live in the Today workspace, not
          here — show a signpost instead of a frozen recap of the live day.
          Past days get the full historical record below. */}
      {isToday ? <TodayLiveCallout recap={recap} tradeCount={data.trades.length} /> : <JournalDayRecord data={data} />}

      <section className="glass space-y-3 rounded-2xl p-4">
        <h2 className="text-sm font-medium text-muted-foreground">Daily Notes</h2>
        <DailyNoteEditor
          dateKey={dateKey}
          initialContent={note?.content ?? null}
          editable={editable}
        />
        <div className="space-y-2 border-t border-border pt-3">
          <h3 className="text-xs font-medium text-muted-foreground">Day images</h3>
          <ImageAttachments ownerType="DAILY_NOTE" ownerId={note.id} max={12} disabled={!editable} />
        </div>
      </section>

      <JournalDayActivity
        data={data}
        dateKey={dateKey}
        editable={editable}
        emptyTradesDescription="Log your first trade for this day — accounts, risk/PnL, checklists, and RR are all tracked per trade."
        tradesAction={
          editable && (
            <Button
              size="sm"
              className="gap-1.5"
              nativeButton={false}
              render={<Link href={`/journal/${dateKey}/trades/new`} />}
            >
              <Plus className="size-3.5" />
              Add Trade
            </Button>
          )
        }
      />
    </FadeIn>
  );
}
