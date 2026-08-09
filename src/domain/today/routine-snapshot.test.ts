import { describe, expect, it } from "vitest";

import {
  allMandatoryComplete,
  isItemComplete,
  mandatoryProgress,
  optionalProgress,
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

describe("mandatory gate", () => {
  const req1: RoutineSnapshotItem = { id: "m1", label: "Bias", type: "CHECKBOX", isMandatory: true };
  const req2: RoutineSnapshotItem = { id: "m2", label: "Calendar", type: "CHECKBOX", isMandatory: true };
  const opt: RoutineSnapshotItem = { id: "o1", label: "Mental prep", type: "CHECKBOX", isMandatory: false };

  const snapshot = (responses: RoutineSnapshot["responses"]): RoutineSnapshot => ({
    sections: [{ id: "s", title: "Prep", items: [req1, req2, opt] }],
    responses,
  });

  it("mandatoryProgress counts only mandatory items", () => {
    expect(mandatoryProgress(snapshot({ m1: { checked: true } }))).toEqual({
      completed: 1,
      total: 2,
      percent: 50,
    });
  });

  it("optionalProgress counts only optional items", () => {
    expect(optionalProgress(snapshot({ o1: { checked: true } }))).toEqual({
      completed: 1,
      total: 1,
      percent: 100,
    });
  });

  it("gate stays closed until ALL mandatory items are complete", () => {
    expect(allMandatoryComplete(snapshot({}))).toBe(false);
    expect(allMandatoryComplete(snapshot({ m1: { checked: true } }))).toBe(false);
    // Completing the optional item does not open the gate.
    expect(allMandatoryComplete(snapshot({ m1: { checked: true }, o1: { checked: true } }))).toBe(false);
    // All mandatory complete → gate opens (optional irrelevant).
    expect(allMandatoryComplete(snapshot({ m1: { checked: true }, m2: { checked: true } }))).toBe(true);
  });

  it("an optional-only (or empty) routine never blocks", () => {
    expect(allMandatoryComplete({ sections: [{ id: "s", title: "P", items: [opt] }], responses: {} })).toBe(true);
    expect(allMandatoryComplete({ sections: [], responses: {} })).toBe(true);
  });

  it("treats a legacy item with no isMandatory flag as optional (never blocks)", () => {
    const legacy: RoutineSnapshotItem = { id: "l", label: "Old", type: "CHECKBOX" };
    expect(allMandatoryComplete({ sections: [{ id: "s", title: "P", items: [legacy] }], responses: {} })).toBe(true);
  });
});
