import { describe, expect, it } from "vitest";

import { wc } from "../testing/m1-fixtures";
import { channelLines, computePosition, defaultPosition, distanceToSegment, fibLevels, formatDuration, lineSegment, logicalToTime, measure, priceOnLine, timeToLogical } from "./geometry";
import { applyOp, DrawingHistory } from "./history";
import { snapPrice, type SnapCandle } from "./magnet";
import { DEFAULT_FIB_LEVELS, defaultStyle, validateDrawing, type ChartDrawing } from "./model";

describe("market coordinates ↔ chart position", () => {
  // H1 candles 08:00, 09:00, 10:00, then a gap (lunch) and 13:00.
  const h1 = ["08:00", "09:00", "10:00", "13:00"].map((t) => wc(`2024-05-14T${t}`));

  it("an anchor keeps its wall-clock time across timeframes (09:17 sits 17 minutes into the 09:00 H1 candle)", () => {
    expect(timeToLogical(h1, 60, wc("2024-05-14T09:17"))).toBeCloseTo(1 + 17 / 60, 6);
    expect(logicalToTime(h1, 60, 1 + 17 / 60)).toBe(wc("2024-05-14T09:17"));
    const m15 = ["09:00", "09:15", "09:30"].map((t) => wc(`2024-05-14T${t}`));
    expect(timeToLogical(m15, 15, wc("2024-05-14T09:17"))).toBeCloseTo(1 + 2 / 15, 6);
  });

  it("times inside a gap attach to the candle before it; the future extrapolates one candle per timeframe", () => {
    expect(timeToLogical(h1, 60, wc("2024-05-14T12:00"))).toBeLessThan(3);
    expect(timeToLogical(h1, 60, wc("2024-05-14T15:00"))).toBeCloseTo(5, 6); // 2 bars past the last candle
    expect(logicalToTime(h1, 60, 5)).toBe(wc("2024-05-14T15:00"));
    expect(timeToLogical(h1, 60, wc("2024-05-14T06:00"))).toBeCloseTo(-2, 6);
  });
});

describe("line geometry", () => {
  it("segment, ray and extended line are computed geometrically (not fixed pixel lengths)", () => {
    const a = { x: 100, y: 100 };
    const b = { x: 200, y: 150 };
    expect(lineSegment(a, b, "segment", 1000, 600)).toEqual([a, b]);
    const [r0, r1] = lineSegment(a, b, "ray", 1000, 600);
    expect(r0).toEqual(a);
    expect(r1.x).toBeGreaterThan(1000); // reaches past the right edge…
    expect((r1.y - a.y) / (r1.x - a.x)).toBeCloseTo(0.5, 6); // …on the same slope
    const [e0, e1] = lineSegment(a, b, "extended", 1000, 600);
    expect(e0.x).toBeLessThan(0);
    expect(e1.x).toBeGreaterThan(1000);
  });

  it("hit distance to a segment", () => {
    expect(distanceToSegment({ x: 150, y: 110 }, { x: 100, y: 100 }, { x: 200, y: 100 })).toBe(10);
    expect(distanceToSegment({ x: 250, y: 100 }, { x: 100, y: 100 }, { x: 200, y: 100 })).toBe(50);
  });

  it("parallel channel keeps the slope and offsets by the third anchor", () => {
    const a = { time: 0, price: 100 };
    const b = { time: 60, price: 110 };
    expect(priceOnLine(a, b, 30)).toBe(105);
    const { parallel } = channelLines(a, b, { time: 30, price: 101 });
    expect(parallel).toEqual([{ time: 0, price: 96 }, { time: 60, price: 106 }]);
  });
});

describe("Fibonacci retracement", () => {
  it("levels run from B (0) back to A (1), exact at the instrument precision", () => {
    const lv = fibLevels({ time: 0, price: 2300 }, { time: 60, price: 2400 }, DEFAULT_FIB_LEVELS, 2);
    expect(lv).toEqual([
      { level: 0, price: 2400 },
      { level: 0.236, price: 2376.4 },
      { level: 0.382, price: 2361.8 },
      { level: 0.5, price: 2350 },
      { level: 0.618, price: 2338.2 },
      { level: 0.786, price: 2321.4 },
      { level: 1, price: 2300 },
    ]);
    // A down swing works the same way.
    expect(fibLevels({ time: 0, price: 1.1 }, { time: 60, price: 1.09 }, [0.618], 5)).toEqual([{ level: 0.618, price: 1.09618 }]);
  });
});

describe("measure (ruler)", () => {
  it("price change, %, MT5 points, time and bars; pips only when the instrument defines them", () => {
    const m = measure({ time: wc("2024-05-14T09:00"), price: 1.07843 }, { time: wc("2024-05-14T11:30"), price: 1.08123 }, 5, { pipSize: 0.0001, bars: 5 });
    expect(m).toEqual({ priceChange: 0.0028, percentChange: 0.26, points: 280, pips: 28, minutes: 150, bars: 5 });
    const gold = measure({ time: 0, price: 2357.42 }, { time: 60, price: 2350.1 }, 2);
    expect(gold).toMatchObject({ priceChange: -7.32, points: -732, pips: null }); // no pip convention guessed
    expect(formatDuration(150)).toBe("2h 30m");
    expect(formatDuration(1440 * 2 + 5)).toBe("2d 5m");
  });
});

describe("Long / Short position", () => {
  it("long: exact risk, reward and R:R per target (no floating-point surprises)", () => {
    const p = computePosition("LONG", { entry: 2350.1, stop: 2347.1, targets: [2357.3, 2362.1] }, 2);
    expect(p).toMatchObject({ valid: true, risk: 3, riskPoints: 300, riskPips: null });
    expect(p.targets.map((t) => [t.reward, t.points, t.rr])).toEqual([[7.2, 720, 2.4], [12, 1200, 4]]);
  });

  it("short: stop above entry, targets below", () => {
    const p = computePosition("SHORT", { entry: 1.0785, stop: 1.0795, targets: [1.0765] }, 5, 0.0001);
    expect(p).toMatchObject({ valid: true, riskPoints: 100, riskPips: 10 });
    expect(p.targets[0]).toMatchObject({ points: 200, pips: 20, rr: 2 });
  });

  it("flags inverted setups instead of silently accepting them", () => {
    expect(computePosition("LONG", { entry: 100, stop: 101, targets: [102] }, 2).issues).toEqual(["Stop must be below entry for a long."]);
    expect(computePosition("SHORT", { entry: 100, stop: 101, targets: [100.5] }, 2).issues).toEqual(["TP1 must be below entry."]);
  });

  it("multiple targets are first-class; defaults place the stop one risk unit away and TP1 at 2R", () => {
    expect(defaultPosition("LONG", 2350, 3, 2)).toEqual({ entry: 2350, stop: 2347, targets: [2356] });
    expect(defaultPosition("SHORT", 1.0785, 0.001, 5)).toEqual({ entry: 1.0785, stop: 1.0795, targets: [1.0765] });
    const three = computePosition("LONG", { entry: 10, stop: 9, targets: [11, 12, 13.5] }, 2);
    expect(three.targets.map((t) => t.rr)).toEqual([1, 2, 3.5]);
  });
});

describe("magnet snapping never sees the future", () => {
  const revealed: SnapCandle[] = [
    { time: 0, open: 100, high: 105, low: 99, close: 104 },
    { time: 60, open: 104, high: 106, low: 103, close: 105 },
  ];
  const priceToY = (p: number) => 1000 - p * 5; // 1 price unit = 5px

  it("snaps to the nearest OHLC of the revealed candle under the pointer within the threshold", () => {
    expect(snapPrice({ y: priceToY(105.6), candleIndex: 1, candles: revealed, priceToY, thresholdPx: 8 })).toEqual({ price: 106, time: 60 });
    expect(snapPrice({ y: priceToY(101), candleIndex: 1, candles: revealed, priceToY, thresholdPx: 8 })).toBeNull(); // too far
  });

  it("over empty future space (no revealed candle) there is nothing to snap to", () => {
    // Even if a future candle with a huge high existed on the server, the chart only holds revealed candles.
    expect(snapPrice({ y: priceToY(999), candleIndex: 2, candles: revealed, priceToY, thresholdPx: 50 })).toBeNull();
    expect(snapPrice({ y: priceToY(105), candleIndex: null, candles: revealed, priceToY, thresholdPx: 50 })).toBeNull();
  });
});

describe("undo / redo", () => {
  const d = (price: number): ChartDrawing => ({ id: "d1", type: "HLINE", assetSymbol: "EURUSD", anchors: [{ time: 0, price }], style: defaultStyle("HLINE"), data: {}, locked: false, hidden: false, linkedTradeId: null });

  it("create → move → delete, then undo all and redo, is exact", () => {
    const h = new DrawingHistory();
    let list: ChartDrawing[] = [];
    const doOp = (op: Parameters<DrawingHistory["record"]>[0]) => {
      list = applyOp(list, op);
      h.record(op);
    };
    doOp({ kind: "create", drawing: d(1.1) });
    doOp({ kind: "update", before: d(1.1), after: d(1.2) });
    doOp({ kind: "delete", drawing: d(1.2) });
    expect(list).toEqual([]);
    list = applyOp(list, h.undo()!); // undo delete
    expect(list[0].anchors[0].price).toBe(1.2);
    list = applyOp(list, h.undo()!); // undo move
    expect(list[0].anchors[0].price).toBe(1.1);
    list = applyOp(list, h.undo()!); // undo create
    expect(list).toEqual([]);
    expect(h.undo()).toBeNull();
    list = applyOp(list, h.redo()!);
    list = applyOp(list, h.redo()!);
    expect(list[0].anchors[0].price).toBe(1.2);
    doOp({ kind: "update", before: d(1.2), after: d(1.3) }); // a new edit clears redo
    expect(h.canRedo()).toBe(false);
  });
});

describe("validation", () => {
  it("anchor counts, finite prices, styles, text and position data", () => {
    const base = { style: defaultStyle("TREND"), data: {} };
    expect(validateDrawing({ type: "TREND", anchors: [{ time: 1, price: 1 }], ...base })).toEqual(["Trend line needs 2 anchor(s)."]);
    expect(validateDrawing({ type: "HLINE", anchors: [{ time: 1, price: Number.NaN }], ...base })).toContain("Invalid anchor price.");
    expect(validateDrawing({ type: "HLINE", anchors: [{ time: 1, price: 1 }], style: { ...base.style, color: "oklch(1 0 0)" }, data: {} })).toContain("Invalid colour.");
    expect(validateDrawing({ type: "LONG", anchors: [{ time: 1, price: 1 }, { time: 2, price: 1 }], style: base.style, data: {} })).toContain("A position needs entry, stop and target.");
    expect(validateDrawing({ type: "LONG", anchors: [{ time: 1, price: 2 }, { time: 2, price: 2 }], style: base.style, data: { position: { entry: 2, stop: 1, targets: [3] } } })).toEqual([]);
  });
});
