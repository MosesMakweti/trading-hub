import { TradeAttachments } from "@/components/journal/workspace/trade-attachments";
import type { TradeWorkspaceDTO } from "@/types/trades";

// Server wrapper: uploads are only offered when image hosting (UploadThing) is
// configured. The token is server-only, so we resolve the flag here and hand the
// client component a plain boolean — existing images render either way.
export function TradeAttachmentsSection({ trade }: { trade: TradeWorkspaceDTO }) {
  const uploadsEnabled = Boolean(process.env.UPLOADTHING_TOKEN);
  return <TradeAttachments trade={trade} uploadsEnabled={uploadsEnabled} />;
}
