/**
 * Trades Album ordering. "Best"/"Worst" are a sort, not a filter — the trader
 * picks the ranking metric (R-multiple or $ P&L); trades with no result yet
 * (open) always sort to the bottom regardless of direction, since they have no
 * performance to rank.
 */
export type AlbumSort = "RECENT" | "OLDEST" | "BEST_RR" | "WORST_RR" | "BEST_PNL" | "WORST_PNL";

export const ALBUM_SORT_OPTIONS: { value: AlbumSort; label: string }[] = [
  { value: "RECENT", label: "Most recent" },
  { value: "OLDEST", label: "Oldest first" },
  { value: "BEST_RR", label: "Best · R-multiple" },
  { value: "WORST_RR", label: "Worst · R-multiple" },
  { value: "BEST_PNL", label: "Best · P&L" },
  { value: "WORST_PNL", label: "Worst · P&L" },
];

export interface SortableTrade {
  actualRR: number | null;
  // Stage C: null = not settled / not calculable yet — a pending trade has
  // no $ performance to rank, same as an open one.
  performancePnlNet: number | null;
}

/** `trades` is assumed already newest-first (the service layer's default order). */
export function sortAlbumTrades<T extends SortableTrade>(trades: T[], sort: AlbumSort): T[] {
  const arr = [...trades];
  switch (sort) {
    case "RECENT":
      return arr;
    case "OLDEST":
      return arr.reverse();
    case "BEST_RR":
      return arr.sort((a, b) => (b.actualRR ?? -Infinity) - (a.actualRR ?? -Infinity));
    case "WORST_RR":
      return arr.sort((a, b) => (a.actualRR ?? Infinity) - (b.actualRR ?? Infinity));
    // Coalesce to the same extremes as BEST_RR/WORST_RR above, not
    // rankOpenLast — a trade can have an actualRR (e.g. a legacy manually
    // entered one) while its Performance PnL is still null/pending, so
    // "open" (actualRR) and "not calculable" (performancePnlNet) are
    // different conditions and neither should crash the other's sort.
    case "BEST_PNL":
      return arr.sort((a, b) => (b.performancePnlNet ?? -Infinity) - (a.performancePnlNet ?? -Infinity));
    case "WORST_PNL":
      return arr.sort((a, b) => (a.performancePnlNet ?? Infinity) - (b.performancePnlNet ?? Infinity));
    default: {
      const _never: never = sort;
      return _never;
    }
  }
}
