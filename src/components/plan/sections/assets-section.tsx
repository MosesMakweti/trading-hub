"use client";

import { SimpleListSection } from "@/components/plan/simple-list-section";
import { archiveAsset, createAsset, reorderAssets, updateAsset } from "@/actions/assets.actions";

interface Asset {
  id: string;
  symbol: string;
  label: string | null;
}

export function AssetsSection({ initialItems }: { initialItems: Asset[] }) {
  return (
    <SimpleListSection
      initialItems={initialItems}
      fields={[
        { key: "symbol", placeholder: "Symbol, e.g. XAUUSD" },
        { key: "label", placeholder: "Label (optional)" },
      ]}
      actions={{
        create: (values) => createAsset(values),
        update: (id, values) => updateAsset(id, values),
        archive: archiveAsset,
        reorder: (orderedIds) => reorderAssets({ orderedIds }),
      }}
      emptyMessage="Your watchlist is empty."
      addLabel="Add asset"
    />
  );
}
