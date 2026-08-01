"use client";

import { SimpleListSection } from "@/components/plan/simple-list-section";
import {
  archiveChecklistItem,
  createChecklistItem,
  reorderChecklistItems,
  updateChecklistItem,
} from "@/actions/checklist-items.actions";

interface RoutineItem {
  id: string;
  label: string;
}

export function PreSessionRoutineSection({ initialItems }: { initialItems: RoutineItem[] }) {
  return (
    <SimpleListSection
      initialItems={initialItems}
      checkable
      fields={[{ key: "label", placeholder: "e.g. Review higher-timeframe bias" }]}
      actions={{
        create: (values) =>
          createChecklistItem({ type: "PRE_SESSION_ROUTINE", label: values.label }),
        update: (id, values) =>
          updateChecklistItem(id, { type: "PRE_SESSION_ROUTINE", label: values.label }),
        archive: archiveChecklistItem,
        reorder: (orderedIds) => reorderChecklistItems({ orderedIds }),
      }}
      emptyMessage="No routine steps yet — add the things you do before every session."
      addLabel="Add routine step"
      itemLabel="routine step"
    />
  );
}
