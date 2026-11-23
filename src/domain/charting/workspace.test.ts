import { describe, expect, it } from "vitest";

import { DEFAULT_WORKSPACE, applyToCharts, normalizeWorkspace, workspaceSchema } from "./workspace";

describe("chart workspace", () => {
  it("has sensible defaults", () => {
    expect(DEFAULT_WORKSPACE.layout).toBe("1");
    expect(DEFAULT_WORKSPACE.charts).toHaveLength(1);
    expect(DEFAULT_WORKSPACE.panels.right.visible).toBe(true);
  });

  it("falls back field by field on bad data and clamps indicator inputs", () => {
    const ws = normalizeWorkspace({
      layout: "4",
      panels: { right: { width: 99999 } },
      charts: [{ timeframe: "H1", studies: [{ uid: "a", kind: "indicator", id: "rsi", inputs: { length: 9999 } }] }],
      settings: { grid: false },
    });
    expect(ws.panels).toEqual(DEFAULT_WORKSPACE.panels); // invalid width → whole field default
    expect(ws.settings.grid).toBe(false);
    expect(ws.charts).toHaveLength(4); // filled to the layout's count
    expect(ws.charts[0].studies[0]).toMatchObject({ id: "rsi", inputs: { length: 500, source: "close" } });
    expect(normalizeWorkspace("garbage")).toEqual(DEFAULT_WORKSPACE);
  });

  it("rejects unknown indicators and oversized lists", () => {
    expect(workspaceSchema.safeParse({ charts: [{ studies: [{ uid: "x", kind: "indicator", id: "evil" }] }] }).success).toBe(false);
    expect(workspaceSchema.safeParse({ charts: new Array(5).fill({}) }).success).toBe(false);
  });

  it("syncs symbol/timeframe only when enabled", () => {
    const ws = normalizeWorkspace({ layout: "2h" });
    expect(applyToCharts(ws, 0, { timeframe: "H4" }).charts.map((c) => c.timeframe)).toEqual(["H4", "M15"]);
    const synced = { ...ws, sync: { ...ws.sync, timeframe: true } };
    expect(applyToCharts(synced, 1, { timeframe: "H4" }).charts.map((c) => c.timeframe)).toEqual(["H4", "H4"]);
  });
});

describe("replay settings", () => {
  it("defaults, clamps out-of-range values field by field, and survives old documents", async () => {
    const { normalizeWorkspace } = await import("./workspace");
    const old = normalizeWorkspace({ layout: "1" }); // saved before replay settings existed
    expect(old.replay).toEqual({ playbackTf: "M1", speedMs: 500, bar: { mode: "floating", x: 0.5, y: 0.9, pinned: false, collapsed: false, visible: true } });
    const bad = normalizeWorkspace({ replay: { playbackTf: "S1", speedMs: 5 } });
    expect(bad.replay.playbackTf).toBe("M1"); // seconds aren't offered: the data is M1
    const ok = normalizeWorkspace({ replay: { playbackTf: "M5", speedMs: 2000, bar: { mode: "top", pinned: true } } });
    expect(ok.replay).toMatchObject({ playbackTf: "M5", speedMs: 2000, bar: { mode: "top", pinned: true, collapsed: false } });
  });
});
