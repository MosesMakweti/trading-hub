import { describe, expect, it } from "vitest";

import { isDayEditable, isTradeWorkspaceEditable } from "./archive";

describe("isDayEditable", () => {
  it("treats a missing day (no TradingDay row) as editable", () => {
    expect(isDayEditable(null)).toBe(true);
  });

  it("treats an active day as editable", () => {
    expect(isDayEditable({ status: "ACTIVE" })).toBe(true);
  });

  it("treats an archived day as read-only", () => {
    expect(isDayEditable({ status: "ARCHIVED" })).toBe(false);
  });
});

describe("isTradeWorkspaceEditable (Stage 9 §15 — carried-open trades)", () => {
  it("is editable on an active day regardless of the trade's lifecycle status", () => {
    expect(isTradeWorkspaceEditable({ status: "ACTIVE" }, { reviewLifecycleStatus: null })).toBe(true);
    expect(isTradeWorkspaceEditable({ status: "ACTIVE" }, { reviewLifecycleStatus: "FULLY_CLOSED" })).toBe(true);
  });

  it("a PARTIALLY_CLOSED trade stays editable on an archived day", () => {
    expect(isTradeWorkspaceEditable({ status: "ARCHIVED" }, { reviewLifecycleStatus: "PARTIALLY_CLOSED" })).toBe(true);
  });

  it("a STILL_HOLDING trade stays editable on an archived day", () => {
    expect(isTradeWorkspaceEditable({ status: "ARCHIVED" }, { reviewLifecycleStatus: "STILL_HOLDING" })).toBe(true);
  });

  it("a FULLY_CLOSED trade on an archived day is NOT editable", () => {
    expect(isTradeWorkspaceEditable({ status: "ARCHIVED" }, { reviewLifecycleStatus: "FULLY_CLOSED" })).toBe(false);
  });

  it("a CANCELLED_NEVER_TRIGGERED trade on an archived day is NOT editable", () => {
    expect(isTradeWorkspaceEditable({ status: "ARCHIVED" }, { reviewLifecycleStatus: "CANCELLED_NEVER_TRIGGERED" })).toBe(
      false,
    );
  });

  it("a never-reviewed trade on an archived day is NOT editable", () => {
    expect(isTradeWorkspaceEditable({ status: "ARCHIVED" }, { reviewLifecycleStatus: null })).toBe(false);
  });
});
