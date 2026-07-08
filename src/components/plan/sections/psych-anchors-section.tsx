"use client";

import { SimpleListSection } from "@/components/plan/simple-list-section";
import {
  archivePsychAnchor,
  createPsychAnchor,
  reorderPsychAnchors,
  updatePsychAnchor,
} from "@/actions/psych-anchors.actions";

interface PsychAnchor {
  id: string;
  text: string;
}

export function PsychAnchorsSection({ initialItems }: { initialItems: PsychAnchor[] }) {
  return (
    <SimpleListSection
      initialItems={initialItems}
      fields={[{ key: "text", placeholder: "e.g. Trade your edge, not your emotions." }]}
      actions={{
        create: (values) => createPsychAnchor(values),
        update: (id, values) => updatePsychAnchor(id, values),
        archive: archivePsychAnchor,
        reorder: (orderedIds) => reorderPsychAnchors({ orderedIds }),
      }}
      emptyMessage="No reminders added yet."
      addLabel="Add reminder"
    />
  );
}
