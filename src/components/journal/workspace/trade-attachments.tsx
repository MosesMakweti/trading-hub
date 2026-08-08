"use client";

import { useWorkspaceEditable } from "@/components/journal/workspace/editable-context";
import { ImageAttachments } from "@/components/media/image-attachments";
import type { TradeWorkspaceDTO } from "@/types/trades";

// Trade screenshots stay bucketed into the three trading categories; each bucket
// is just the universal <ImageAttachments> scoped to this trade + category. An
// archived (read-only) day disables upload/delete but still shows the images.
const CATEGORIES = [
  { key: "ANALYSIS", label: "Analysis charts" },
  { key: "BEFORE", label: "Before trade" },
  { key: "AFTER", label: "After trade" },
] as const;

const MAX_PER_CATEGORY = 6;

export function TradeAttachments({ trade }: { trade: TradeWorkspaceDTO }) {
  const editable = useWorkspaceEditable();

  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
      {CATEGORIES.map((cat) => (
        <div key={cat.key} className="glass rounded-xl p-3">
          <ImageAttachments
            ownerType="TRADE"
            ownerId={trade.id}
            category={cat.key}
            label={cat.label}
            max={MAX_PER_CATEGORY}
            disabled={!editable}
          />
        </div>
      ))}
    </div>
  );
}
