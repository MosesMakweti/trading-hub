import { BookOpenText } from "lucide-react";

import { EmptyState } from "@/components/shared/empty-state";

export default function JournalPage() {
  return (
    <div className="mx-auto max-w-5xl">
      <h1 className="mb-6 text-2xl font-semibold tracking-tight">Journal</h1>
      <EmptyState
        icon={BookOpenText}
        title="Journal calendar coming soon"
        description="The Trading Plan, month/year calendar, trade entries, and psychology scoring will be built in upcoming phases."
      />
    </div>
  );
}
