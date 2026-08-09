"use client";

import { useWorkspaceEditable } from "@/components/journal/workspace/editable-context";
import { ImageAttachments } from "@/components/media/image-attachments";

/**
 * A single-category image bucket for a trade, wired into the workspace's
 * editable context so it follows the same read-only rule as the inline fields
 * (an archived day disables upload/delete; uploads are also blocked server-side).
 * Before-Trade images live in the Trade Idea section, After-Trade in Execution —
 * they never mix, because each bucket is scoped to its own category.
 */
export function TradeImageBucket({
  tradeId,
  category,
  label,
  max = 8,
}: {
  tradeId: string;
  category: "BEFORE" | "AFTER";
  label: string;
  max?: number;
}) {
  const editable = useWorkspaceEditable();
  return (
    <ImageAttachments
      ownerType="TRADE"
      ownerId={tradeId}
      category={category}
      label={label}
      max={max}
      disabled={!editable}
    />
  );
}
