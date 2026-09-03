import { describe, expect, it } from "vitest";

import { sortAlbumTrades, type SortableTrade } from "@/domain/trades/album-sort";

interface T extends SortableTrade {
  id: string;
}

const trades: T[] = [
  { id: "a", actualRR: 1, performancePnlNet: 500 },
  { id: "b", actualRR: -2, performancePnlNet: -900 },
  { id: "c", actualRR: 3, performancePnlNet: 200 },
  { id: "d", actualRR: null, performancePnlNet: 0 }, // open — no result yet
];

const ids = (t: T[]) => t.map((x) => x.id);

describe("sortAlbumTrades", () => {
  it("RECENT/OLDEST preserve or reverse input order without touching open trades", () => {
    expect(ids(sortAlbumTrades(trades, "RECENT"))).toEqual(["a", "b", "c", "d"]);
    expect(ids(sortAlbumTrades(trades, "OLDEST"))).toEqual(["d", "c", "b", "a"]);
  });

  it("ranks by R-multiple, open trades last regardless of direction", () => {
    expect(ids(sortAlbumTrades(trades, "BEST_RR"))).toEqual(["c", "a", "b", "d"]);
    expect(ids(sortAlbumTrades(trades, "WORST_RR"))).toEqual(["b", "a", "c", "d"]);
  });

  it("ranks by $ P&L, open trades last regardless of direction", () => {
    expect(ids(sortAlbumTrades(trades, "BEST_PNL"))).toEqual(["a", "c", "b", "d"]);
    expect(ids(sortAlbumTrades(trades, "WORST_PNL"))).toEqual(["b", "c", "a", "d"]);
  });

  it("does not mutate the input array", () => {
    const copy = [...trades];
    sortAlbumTrades(trades, "BEST_RR");
    expect(trades).toEqual(copy);
  });
});
