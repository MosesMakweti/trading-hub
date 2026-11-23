import { describe, expect, it } from "vitest";

import { barFractions, barPosition, DOCK_MARGIN } from "./replay-bar-layout";

const area = { w: 1000, h: 600 };
const bar = { w: 400, h: 40 };

describe("replay toolbar placement", () => {
  it("floating: fractions of the free space, round-tripping through a drag", () => {
    expect(barPosition(area, bar, { mode: "floating", x: 0.5, y: 1 })).toEqual({ left: 300, top: 560 });
    const f = barFractions(area, bar, 150, 280);
    expect(f).toEqual({ x: 0.25, y: 0.5 });
    expect(barPosition(area, bar, { mode: "floating", ...f })).toEqual({ left: 150, top: 280 });
  });

  it("can never be dragged outside the area", () => {
    expect(barFractions(area, bar, -500, 99999)).toEqual({ x: 0, y: 1 });
    expect(barPosition(area, bar, { mode: "floating", x: 7, y: -3 })).toEqual({ left: 600, top: 0 });
  });

  it("keeps its relative place when the area resizes", () => {
    const small = barPosition({ w: 600, h: 300 }, bar, { mode: "floating", x: 1, y: 1 });
    expect(small).toEqual({ left: 200, top: 260 }); // still bottom-right, fully visible
  });

  it("docked top/bottom: centred with a margin; an area smaller than the bar pins to 0", () => {
    expect(barPosition(area, bar, { mode: "top", x: 0, y: 0 })).toEqual({ left: 300, top: DOCK_MARGIN });
    expect(barPosition(area, bar, { mode: "bottom", x: 0, y: 0 })).toEqual({ left: 300, top: 600 - 40 - DOCK_MARGIN });
    expect(barPosition({ w: 300, h: 30 }, bar, { mode: "floating", x: 0.5, y: 0.5 })).toEqual({ left: 0, top: 0 });
  });
});
