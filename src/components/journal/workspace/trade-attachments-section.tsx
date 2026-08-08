import { TradeAttachments } from "@/components/journal/workspace/trade-attachments";
import type { TradeWorkspaceDTO } from "@/types/trades";

// Thin wrapper kept for import stability. The universal <ImageAttachments> inside
// resolves upload availability (UploadThing config) itself, so there is nothing to
// thread through here anymore.
export function TradeAttachmentsSection({ trade }: { trade: TradeWorkspaceDTO }) {
  return <TradeAttachments trade={trade} />;
}
