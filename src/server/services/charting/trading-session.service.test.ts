import { afterAll, describe, expect, it } from "vitest";

import { createTestUser, deleteTestUsers } from "@/server/testing/cleanup";
import { createTradingSession, deleteTradingSession, listTradingSessions, updateTradingSession, type SessionInput } from "./trading-session.service";

const userIds: string[] = [];
afterAll(() => deleteTestUsers(...userIds));
const killzone: SessionInput = { name: "London Killzone", start: "07:00", end: "10:00", timeZone: "Europe/London", days: [1, 2, 3, 4, 5], color: "#8ab4f8", description: null, enabled: true };

describe("custom trading sessions", () => {
  it("create, edit, list, delete — per user only", async () => {
    const a = await createTestUser("sess-a");
    const b = await createTestUser("sess-b");
    userIds.push(a.id, b.id);
    const s = await createTradingSession(a.id, killzone);
    expect(s).toMatchObject({ name: "London Killzone", timeZone: "Europe/London", days: [1, 2, 3, 4, 5] });
    const edited = await updateTradingSession(a.id, s.id, { ...killzone, name: "Asian range", start: "20:00", end: "00:00", timeZone: "America/New_York", days: [0, 1, 2, 3, 4, 4] });
    expect(edited).toMatchObject({ name: "Asian range", end: "00:00", days: [0, 1, 2, 3, 4] });
    expect(await listTradingSessions(b.id)).toEqual([]);
    await expect(updateTradingSession(b.id, s.id, killzone)).rejects.toThrow(/not found/);
    await expect(deleteTradingSession(b.id, s.id)).rejects.toThrow(/not found/);
    await deleteTradingSession(a.id, s.id);
    expect(await listTradingSessions(a.id)).toEqual([]);
  });

  it("rejects unknown time zones and empty sessions", async () => {
    const u = await createTestUser("sess-v");
    userIds.push(u.id);
    await expect(createTradingSession(u.id, { ...killzone, timeZone: "Mars/Olympus" })).rejects.toThrow(/time zone/);
    await expect(createTradingSession(u.id, { ...killzone, end: "07:00" })).rejects.toThrow(/different start and end/);
  });
});
