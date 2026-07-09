import { describe, expect, it } from "vitest";

import { nextSessionEvent, type SessionWindow } from "./session-countdown";

const LONDON: SessionWindow = { id: "1", name: "London", startMinutes: 480, endMinutes: 720 }; // 08:00-12:00
const NY: SessionWindow = { id: "2", name: "New York", startMinutes: 780, endMinutes: 1020 }; // 13:00-17:00
const OVERNIGHT: SessionWindow = { id: "3", name: "Sydney", startMinutes: 1320, endMinutes: 360 }; // 22:00-06:00

describe("nextSessionEvent", () => {
  it("returns null when no sessions are configured", () => {
    expect(nextSessionEvent([], 600)).toBeNull();
  });

  it("reports 'active' when now falls inside a session window", () => {
    const result = nextSessionEvent([LONDON, NY], 600); // 10:00, inside London
    expect(result?.status).toBe("active");
    expect(result?.session.id).toBe("1");
    expect(result?.minutesUntil).toBe(120); // 2h until London closes
  });

  it("reports the soonest upcoming session when none are active", () => {
    const result = nextSessionEvent([LONDON, NY], 60); // 01:00, before both
    expect(result?.status).toBe("upcoming");
    expect(result?.session.id).toBe("1"); // London (08:00) is sooner than NY (13:00)
    expect(result?.minutesUntil).toBe(420); // 7h until 08:00
  });

  it("wraps to the next day when the soonest session already passed today", () => {
    const result = nextSessionEvent([LONDON], 1000); // after London closed for the day
    expect(result?.status).toBe("upcoming");
    expect(result?.minutesUntil).toBe(1440 - 1000 + 480);
  });

  it("handles an overnight session window that wraps past midnight", () => {
    const activeLate = nextSessionEvent([OVERNIGHT], 1380); // 23:00, inside the overnight window
    expect(activeLate?.status).toBe("active");
    expect(activeLate?.minutesUntil).toBe(1440 - 1380 + 360);

    const activeEarly = nextSessionEvent([OVERNIGHT], 120); // 02:00, still inside (wrapped)
    expect(activeEarly?.status).toBe("active");
    expect(activeEarly?.minutesUntil).toBe(360 - 120);
  });
});
