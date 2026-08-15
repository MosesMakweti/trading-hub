import type { MediaItemDTO } from "@/server/services/media.service";
import type { TradeWorkspaceDTO } from "@/types/trades";

/** One attached screenshot, positioned in the trade's review flow. */
export interface AlbumImageDTO extends MediaItemDTO {
  /** "Entry" (Before-Trade) / "Exit" (After-Trade) / "Screenshot" (uncategorized). */
  phaseLabel: string;
}

/** A trade plus every screenshot attached to it, for the Trades Album. */
export interface AlbumTradeDTO extends TradeWorkspaceDTO {
  images: AlbumImageDTO[];
  // Prop Firms module (final phase) — summarizes ALL of this idea's account
  // executions (never duplicating the trade into multiple album rows). See
  // domain/trades/filter.ts's matching FilterableTrade fields.
  propFirmAccountIds: string[];
  propFirmIds: string[];
  marketCategories: ("CFD" | "FUTURES")[];
  fundedOrChallenge: "FUNDED" | "CHALLENGE" | null;
}
