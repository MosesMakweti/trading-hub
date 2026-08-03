import { requireUser } from "@/server/guards";
import { listEntryModelPatterns } from "@/server/services/strategy-entry-models.service";
import { FadeIn } from "@/components/shared/motion";
import { PatternLibraryView } from "@/components/strategy-lab/pattern-library-view";

export default async function PatternLibraryPage() {
  const user = await requireUser();
  const patterns = await listEntryModelPatterns(user.id);

  return (
    <FadeIn className="mx-auto max-w-4xl">
      <PatternLibraryView patterns={patterns} />
    </FadeIn>
  );
}
