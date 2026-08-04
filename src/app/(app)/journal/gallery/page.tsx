import { requireUser } from "@/server/guards";
import { listAllTrades } from "@/server/services/trades.service";
import { toTradeWorkspaceDTO } from "@/server/services/trade-workspace.mapper";
import { FadeIn } from "@/components/shared/motion";
import { TradeGallery } from "@/components/journal/trade-gallery";

export default async function TradeGalleryPage() {
  const user = await requireUser();
  const trades = await listAllTrades(user.id);

  return (
    <FadeIn className="mx-auto max-w-6xl">
      <TradeGallery trades={trades.map(toTradeWorkspaceDTO)} />
    </FadeIn>
  );
}
