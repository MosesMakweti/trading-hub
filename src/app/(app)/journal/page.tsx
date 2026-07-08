import { requireUser } from "@/server/guards";
import { listNoteDateKeys } from "@/server/services/journal.service";
import { JournalCalendar } from "@/components/journal/journal-calendar";

export default async function JournalPage() {
  const user = await requireUser();
  const noteDates = await listNoteDateKeys(user.id);

  return (
    <div className="mx-auto max-w-5xl">
      <h1 className="mb-6 text-2xl font-semibold tracking-tight">Journal</h1>
      <JournalCalendar noteDates={noteDates} />
    </div>
  );
}
