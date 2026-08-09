import { requireUser } from "@/server/guards";
import { listAllTrades } from "@/server/services/trades.service";
import { toTradeWorkspaceDTO } from "@/server/services/trade-workspace.mapper";
import { listTradePreviewImages } from "@/server/services/media.service";
import { FadeIn } from "@/components/shared/motion";
import { TradeGallery } from "@/components/journal/trade-gallery";

export default async function TradeGalleryPage() {
  const user = await requireUser();
  const trades = await listAllTrades(user.id);

  // One batched query for the gallery's per-trade preview thumbnails.
  const previews = await listTradePreviewImages(
    user.id,
    trades.map((t) => t.id),
  );
  const dtos = trades.map((t) => ({
    ...toTradeWorkspaceDTO(t),
    previewImageUrl: previews.get(t.id) ?? null,
  }));

  return (
    <FadeIn className="mx-auto max-w-6xl">
      <TradeGallery trades={dtos} />
    </FadeIn>
  );
}
