import { describe, expect, it } from "vitest";

import {
  isItemComplete,
  routineProgress,
  type RoutineSnapshot,
  type RoutineSnapshotItem,
} from "./routine-snapshot";

const checkbox: RoutineSnapshotItem = { id: "a", label: "Slept well", type: "CHECKBOX" };
const shortText: RoutineSnapshotItem = { id: "b", label: "Bias", type: "SHORT_TEXT" };

describe("isItemComplete", () => {
  it("checkbox requires checked === true", () => {
    expect(isItemComplete(checkbox, undefined)).toBe(false);
    expect(isItemComplete(checkbox, { checked: false })).toBe(false);
    expect(isItemComplete(checkbox, { checked: true })).toBe(true);
  });

  it("text requires non-blank content", () => {
    expect(isItemComplete(shortText, undefined)).toBe(false);
    expect(isItemComplete(shortText, { text: "   " })).toBe(false);
    expect(isItemComplete(shortText, { text: "Bullish" })).toBe(true);
  });
});

describe("routineProgress", () => {
  it("counts completed items across sections", () => {
    const snapshot: RoutineSnapshot = {
      sections: [
        { id: "s1", title: "A", items: [checkbox, shortText] },
        { id: "s2", title: "B", items: [{ id: "c", label: "Notes", type: "LONG_TEXT" }] },
      ],
      responses: { a: { checked: true }, b: { text: "" }, c: { text: "did the work" } },
    };
    expect(routineProgress(snapshot)).toEqual({ completed: 2, total: 3, percent: 67 });
  });

  it("is 0/0 → 0% for an empty routine", () => {
    expect(routineProgress({ sections: [], responses: {} })).toEqual({
      completed: 0,
      total: 0,
      percent: 0,
    });
  });
});
