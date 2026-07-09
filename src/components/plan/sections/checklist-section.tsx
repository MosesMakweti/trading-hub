"use client";

import { SimpleListSection } from "@/components/plan/simple-list-section";
import {
  archiveChecklistItem,
  createChecklistItem,
  reorderChecklistItems,
  updateChecklistItem,
} from "@/actions/checklist-items.actions";
import type { ChecklistType } from "@prisma/client";

interface ChecklistItem {
  id: string;
  label: string;
}

export function ChecklistSection({
  type,
  initialItems,
}: {
  type: ChecklistType;
  initialItems: ChecklistItem[];
}) {
  return (
    <SimpleListSection
      initialItems={initialItems}
      fields={[{ key: "label", placeholder: "e.g. Fair Value Gap" }]}
      actions={{
        create: (values) => createChecklistItem({ type, label: values.label }),
        update: (id, values) => updateChecklistItem(id, { type, label: values.label }),
        archive: archiveChecklistItem,
        reorder: (orderedIds) => reorderChecklistItems({ orderedIds }),
      }}
      emptyMessage="No checklist items yet."
      addLabel="Add item"
      itemLabel="checklist item"
    />
  );
}
