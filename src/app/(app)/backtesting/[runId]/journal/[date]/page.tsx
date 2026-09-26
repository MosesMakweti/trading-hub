import { notFound } from "next/navigation";
import { ChevronLeft, ChevronRight } from "lucide-react";

import { loadOwnedRun } from "../../load-run";
import { isValidDateKey } from "@/lib/date";
import { isWithinRun, nextTradingDayKey, previousTradingDayKey, type RunPeriod } from "@/domain/backtesting/run-calendar";
import { runInBacktestRun } from "@/server/services/backtest-run.service";
import { loadJournalDay } from "@/server/services/journal-day-view.service";
import { Badge } from "@/components/ui/badge";
import { FadeIn } from "@/components/shared/motion";
import { ReadOnlyDayBanner } from "@/components/journal/read-only-day-banner";
import { JournalDayActivity, JournalDayRecord } from "@/components/journal/day/journal-day-history";
import { WorkspaceProvider } from "@/components/workspace/workspace-context";
import { getDailyNote } from "@/server/services/journal.service";
import { DailyNoteEditor } from "@/components/journal/daily-note-editor";
import { ImageAttachments } from "@/components/media/image-attachments";
import { formatSimDate, formatSimDateCompact, formatSimWeekday } from "@/components/backtesting/format";
import { ButtonLink, DisabledButtonLink } from "@/components/backtesting/button-link";

/**
 * A simulated day's historical record — the SAME loader and record components
 * as the live Journal day, read inside the run's scope. Review-only: every
 * change to a simulated day happens in the Session.
 */
export default async function BacktestJournalDayPage({ params }: { params: Promise<{ runId: string; date: string }> }) {
  const { runId, date: dateKey } = await params;
  const { user, run } = await loadOwnedRun(runId);
  const period: RunPeriod = { startDateKey: run.startDateKey, endDateKey: run.endDateKey, tradingWeekdays: run.tradingWeekdays };
  if (!isValidDateKey(dateKey) || !isWithinRun(period, dateKey)) notFound();

  // Read-only: the note row is only created when the trader first writes one.
  const [data, note] = await runInBacktestRun(user.id, run.id, () =>
    Promise.all([loadJournalDay(user.id, dateKey, { historical: true }), getDailyNote(user.id, dateKey)]),
  );
  const notesEditable = run.status === "ACTIVE";
  const prevKey = previousTradingDayKey(period, dateKey);
  const nextKey = nextTradingDayKey(period, dateKey);
  const base = `/backtesting/${run.id}/journal`;
  const closed = data.recap?.status === "ARCHIVED";

  return (
    <FadeIn className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          {prevKey ? (
            <ButtonLink href={`${base}/${prevKey}`} variant="ghost" size="icon-sm" aria-label={`Previous trading day, ${formatSimDate(prevKey)}`}>
              <ChevronLeft aria-hidden />
            </ButtonLink>
          ) : (
            <DisabledButtonLink variant="ghost" size="icon-sm" aria-label="No earlier trading day in this run">
              <ChevronLeft aria-hidden />
            </DisabledButtonLink>
          )}
          <div>
            <p className="text-[11px] font-medium tracking-wide text-muted-foreground uppercase">{formatSimWeekday(dateKey)}</p>
            <div className="flex items-center gap-2">
              <h2 className="text-xl font-semibold tracking-tight tabular-nums">{formatSimDate(dateKey)}</h2>
              <Badge variant={closed ? "success" : data.recap ? "secondary" : "outline"}>{closed ? "Completed" : data.recap ? "In progress" : "Not started"}</Badge>
            </div>
          </div>
          {nextKey ? (
            <ButtonLink href={`${base}/${nextKey}`} variant="ghost" size="icon-sm" aria-label={`Next trading day, ${formatSimDate(nextKey)}`}>
              <ChevronRight aria-hidden />
            </ButtonLink>
          ) : (
            <DisabledButtonLink variant="ghost" size="icon-sm" aria-label="No later trading day in this run">
              <ChevronRight aria-hidden />
            </DisabledButtonLink>
          )}
        </div>
        <div className="flex items-center gap-2">
          {nextKey && <span className="hidden text-xs text-muted-foreground sm:inline">Next: {formatSimDateCompact(nextKey)}</span>}
          <ButtonLink href={base} variant="outline" size="sm">
            Back to calendar
          </ButtonLink>
        </div>
      </div>

      <WorkspaceProvider value={{ environment: "BACKTEST", runId: run.id }}>
        <ReadOnlyDayBanner dateKey={dateKey} />
        <JournalDayRecord data={data} showPnl={false} />
        <section className="glass space-y-3 rounded-2xl p-4" aria-labelledby="bt-notes-heading">
          <h3 id="bt-notes-heading" className="text-sm font-medium text-muted-foreground">
            Review notes
          </h3>
          <DailyNoteEditor dateKey={dateKey} initialContent={note?.content ?? null} editable={notesEditable} />
          {note ? (
            <div className="space-y-2 border-t border-border pt-3">
              <h4 className="text-xs font-medium text-muted-foreground">Day images</h4>
              <ImageAttachments ownerType="DAILY_NOTE" ownerId={note.id} max={12} disabled={!notesEditable} />
            </div>
          ) : (
            notesEditable && <p className="text-[11px] text-muted-foreground">Write a note to attach images to this day.</p>
          )}
        </section>
        <JournalDayActivity
          data={data}
          dateKey={dateKey}
          editable={false}
          emptyTradesDescription="No trades were logged on this simulated day."
        />
      </WorkspaceProvider>
    </FadeIn>
  );
}
