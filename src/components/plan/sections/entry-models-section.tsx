"use client";

import { SimpleListSection } from "@/components/plan/simple-list-section";
import {
  archiveEntryModel,
  createEntryModel,
  reorderEntryModels,
  updateEntryModel,
} from "@/actions/entry-models.actions";

interface EntryModel {
  id: string;
  name: string;
  description: string | null;
}

export function EntryModelsSection({ initialItems }: { initialItems: EntryModel[] }) {
  return (
    <SimpleListSection
      initialItems={initialItems}
      fields={[
        { key: "name", placeholder: "e.g. Liquidity Sweep" },
        { key: "description", placeholder: "Description (optional)" },
      ]}
      actions={{
        create: (values) => createEntryModel(values),
        update: (id, values) => updateEntryModel(id, values),
        archive: archiveEntryModel,
        reorder: (orderedIds) => reorderEntryModels({ orderedIds }),
      }}
      emptyMessage="No entry models defined yet."
      addLabel="Add entry model"
    />
  );
}
