import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronLeft, ChevronRight, ListChecks } from "lucide-react";

import { requireUser } from "@/server/guards";
import { getDailyNote } from "@/server/services/journal.service";
import { addDaysToKey, formatDateKeyLong, isValidDateKey, localDateToKey } from "@/lib/date";
import { Button } from "@/components/ui/button";
import { DailyNoteEditor } from "@/components/journal/daily-note-editor";
import { EmptyState } from "@/components/shared/empty-state";

export default async function JournalDayPage({
  params,
}: {
  params: Promise<{ date: string }>;
}) {
  const { date: dateKey } = await params;
  if (!isValidDateKey(dateKey)) notFound();

  const user = await requireUser();
  const note = await getDailyNote(user.id, dateKey);

  const isToday = dateKey === localDateToKey(new Date());
  const prevKey = addDaysToKey(dateKey, -1);
  const nextKey = addDaysToKey(dateKey, 1);

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Button
            variant="ghost"
            size="icon-sm"
            nativeButton={false}
            render={<Link href={`/journal/${prevKey}`} />}
          >
            <ChevronLeft />
          </Button>
          <div>
            <h1 className="text-xl font-semibold tracking-tight">
              {formatDateKeyLong(dateKey)}
            </h1>
            {isToday && <p className="text-xs text-primary">Today</p>}
          </div>
          <Button
            variant="ghost"
            size="icon-sm"
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

      <section className="glass space-y-3 rounded-2xl p-4">
        <h2 className="text-sm font-medium text-muted-foreground">Daily Notes</h2>
        <DailyNoteEditor dateKey={dateKey} initialContent={note?.content ?? null} />
      </section>

      <section className="space-y-3">
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-sm font-medium text-muted-foreground">Trades</h2>
          <Button size="sm" disabled title="Trade logging arrives in Phase 5">
            Add Trade
          </Button>
        </div>
        <EmptyState
          icon={ListChecks}
          title="No trades logged yet"
          description="Trade entry, per-account risk/PnL, checklists, and psychology scoring are built in the next phase."
        />
      </section>
    </div>
  );
}
