import { requireUser } from "@/server/guards";
import { listAllTrades } from "@/server/services/trades.service";
import { toTradeWorkspaceDTO } from "@/server/services/trade-workspace.mapper";
import { listTradeMediaForTrades } from "@/server/services/media.service";
import { listExecutionsForTrades } from "@/server/services/trade-executions.service";
import { isFundedStageType } from "@/domain/prop-firms/metrics";
import { FadeIn } from "@/components/shared/motion";
import { TradesAlbum } from "@/components/trades-album/trades-album";
import type { AlbumTradeDTO } from "@/types/trades-album";

function phaseLabel(category: string | null): string {
  if (category === "BEFORE") return "Entry";
  if (category === "AFTER") return "Exit";
  return "Screenshot";
}

export default async function TradesAlbumPage() {
  const user = await requireUser();
  const trades = await listAllTrades(user.id);

  // One batched query for every trade's full image set (not just a preview).
  const [mediaByTrade, executions] = await Promise.all([
    listTradeMediaForTrades(user.id, trades.map((t) => t.id)),
    listExecutionsForTrades(user.id, trades.map((t) => t.id)),
  ]);

  const executionsByTradeId = new Map<string, typeof executions>();
  for (const execution of executions) {
    const bucket = executionsByTradeId.get(execution.tradeId);
    if (bucket) bucket.push(execution);
    else executionsByTradeId.set(execution.tradeId, [execution]);
  }

  const dtos: AlbumTradeDTO[] = trades.map((t) => {
    const tradeExecutions = executionsByTradeId.get(t.id) ?? [];
    const fundedFlags = tradeExecutions.map((e) => isFundedStageType(e.accountStage.type));
    return {
      ...toTradeWorkspaceDTO(t),
      images: (mediaByTrade.get(t.id) ?? []).map((image) => ({
        ...image,
        phaseLabel: phaseLabel(image.category),
      })),
      propFirmAccountIds: [...new Set(tradeExecutions.map((e) => e.propFirmAccountId))],
      propFirmIds: [...new Set(tradeExecutions.map((e) => e.propFirmAccount.userPropFirmId))],
      marketCategories: [...new Set(tradeExecutions.map((e) => e.propFirmAccount.marketCategory))],
      fundedOrChallenge: fundedFlags.length === 0 ? null : fundedFlags.some(Boolean) ? "FUNDED" : "CHALLENGE",
    };
  });

  const accountOptions = [...new Map(executions.map((e) => [e.propFirmAccountId, e.propFirmAccount.displayName])).entries()].map(
    ([id, label]) => ({ id, label }),
  );
  const firmOptions = [
    ...new Map(
      executions.map((e) => [
        e.propFirmAccount.userPropFirmId,
        e.propFirmAccount.userPropFirm.directoryEntry?.companyName ?? e.propFirmAccount.userPropFirm.customCompanyName ?? "Unnamed firm",
      ]),
    ).entries(),
  ].map(([id, label]) => ({ id, label }));

  return (
    <FadeIn className="mx-auto max-w-6xl">
      <TradesAlbum trades={dtos} propFirmAccountOptions={accountOptions} propFirmOptions={firmOptions} />
    </FadeIn>
  );
}
