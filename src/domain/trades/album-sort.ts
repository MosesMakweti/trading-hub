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
  performancePnlNet: number;
}

/** Open trades (no result yet) always sort last, regardless of direction.
 *  Returns a comparator result when either side is open, else null (defer to
 *  the caller's real metric comparison). */
function rankOpenLast(a: SortableTrade, b: SortableTrade): number | null {
  const aOpen = a.actualRR == null;
  const bOpen = b.actualRR == null;
  if (aOpen && bOpen) return 0;
  if (aOpen) return 1;
  if (bOpen) return -1;
  return null;
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
    case "BEST_PNL":
      return arr.sort((a, b) => rankOpenLast(a, b) ?? b.performancePnlNet - a.performancePnlNet);
    case "WORST_PNL":
      return arr.sort((a, b) => rankOpenLast(a, b) ?? a.performancePnlNet - b.performancePnlNet);
    default: {
      const _never: never = sort;
      return _never;
    }
  }
}
