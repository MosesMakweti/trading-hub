import { describe, expect, it } from "vitest";

import { isDayEditable } from "./archive";

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
