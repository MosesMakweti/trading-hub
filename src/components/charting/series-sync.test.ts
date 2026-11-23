import { describe, expect, it } from "vitest";

import { MAX_PATCH_POINTS, syncSeries, type SeriesLike } from "./series-sync";

type P = { time: number; value?: number; color?: string };

/** A fake series that applies setData/update like lightweight-charts and records calls. */
function fake(initial: P[] = []) {
  let data = [...initial];
  const calls: string[] = [];
  const s: SeriesLike<P> = {
    setData(d) {
      calls.push(`set:${d.length}`);
      data = [...d];
    },
    update(p, historical) {
      calls.push(`update:${p.time}${historical ? ":h" : ""}`);
      const i = data.findIndex((x) => x.time === p.time);
      if (i >= 0) {
        if (i < data.length - 1 && !historical) throw new Error("not the last bar");
        data[i] = p;
      } else {
        if (data.length && p.time <= data[data.length - 1].time) throw new Error("out of order");
        data.push(p);
      }
    },
  };
  return { s, calls, data: () => data };
}

const pts = (n: number, f = (i: number) => i * 1.5): P[] => Array.from({ length: n }, (_, i) => ({ time: 100 + i, value: f(i) }));

describe("syncSeries", () => {
  it("first load and shrinking data use setData", () => {
    const f = fake();
    expect(syncSeries(f.s, undefined, pts(10))).toEqual({ kind: "set" });
    expect(syncSeries(f.s, pts(10), pts(8))).toEqual({ kind: "set" });
    expect(f.data()).toEqual(pts(8));
  });

  it("a replay step updates only the forming point and appends new ones", () => {
    const prev = pts(500);
    const next = [...prev.slice(0, 499), { time: 599, value: 42 }, { time: 600, value: 43 }];
    const f = fake(prev);
    expect(syncSeries(f.s, prev, next)).toEqual({ kind: "patch", points: 2 });
    expect(f.calls).toEqual(["update:599", "update:600"]);
    expect(f.data()).toEqual(next);
  });

  it("an older changed point (e.g. a lagging span) is a historical update", () => {
    const prev = pts(100);
    const next = prev.map((p) => (p.time === 150 ? { ...p, value: -1 } : p));
    const f = fake(prev);
    syncSeries(f.s, prev, next);
    expect(f.calls).toEqual(["update:150:h"]);
    expect(f.data()).toEqual(next);
  });

  it("identical data does nothing; shifted or large changes fall back to setData", () => {
    const prev = pts(50);
    expect(syncSeries(fake(prev).s, prev, pts(50))).toEqual({ kind: "none" });
    expect(syncSeries(fake(prev).s, prev, prev.map((p) => ({ ...p, time: p.time + 1 })))).toEqual({ kind: "set" });
    const many = pts(MAX_PATCH_POINTS + 10);
    expect(syncSeries(fake(many).s, many, pts(MAX_PATCH_POINTS + 10, (i) => -i - 1))).toEqual({ kind: "set" });
    expect(syncSeries(fake(prev).s, prev, pts(50 + MAX_PATCH_POINTS + 1))).toEqual({ kind: "set" });
  });

  it("whitespace (no value) and colour changes count as changes", () => {
    const prev: P[] = [{ time: 1, value: 1 }, { time: 2 }];
    const next: P[] = [{ time: 1, value: 1, color: "#fff" }, { time: 2, value: 3 }];
    const f = fake(prev);
    expect(syncSeries(f.s, prev, next)).toEqual({ kind: "patch", points: 2 });
    expect(f.data()).toEqual(next);
  });
});
