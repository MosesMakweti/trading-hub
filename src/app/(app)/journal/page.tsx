import Link from "next/link";
import { BarChart3, Images, PlaySquare } from "lucide-react";

import { requireUser } from "@/server/guards";
import { listNoteDateKeys } from "@/server/services/journal.service";
import { listDailyPnl } from "@/server/services/trades.service";
import { Button } from "@/components/ui/button";
import { JournalCalendar } from "@/components/journal/journal-calendar";
import { FadeIn } from "@/components/shared/motion";

export default async function JournalPage() {
  const user = await requireUser();

  const [noteDates, dailyPnl] = await Promise.all([
    listNoteDateKeys(user.id),
    listDailyPnl(user.id),
  ]);

  return (
    <FadeIn className="mx-auto max-w-5xl space-y-6">
      <div className="flex items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold tracking-tight">Journal</h1>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            className="gap-1.5"
            nativeButton={false}
            render={<Link href="/analytics" />}
          >
            <BarChart3 className="size-4" />
            Analytics
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="gap-1.5"
            nativeButton={false}
            render={<Link href="/journal/gallery" />}
          >
            <Images className="size-4" />
            Trade gallery
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="gap-1.5"
            nativeButton={false}
            render={<Link href="/trades-album" />}
          >
            <PlaySquare className="size-4" />
            Trades Album
          </Button>
        </div>
      </div>
      <JournalCalendar noteDates={noteDates} dailyPnl={dailyPnl} />
    </FadeIn>
  );
}
