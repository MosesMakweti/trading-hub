import { afterAll, describe, expect, it } from "vitest";

import { prisma } from "@/server/db";
import { createTestUser, deleteTestUsers } from "@/server/testing/cleanup";
import { getOrCreateDefaultRoutine } from "@/server/services/routine.service";
import { DEFAULT_ROUTINE } from "@/domain/today/default-routine";

const userIds: string[] = [];
afterAll(() => deleteTestUsers(...userIds));

describe("getOrCreateDefaultRoutine", () => {
  it("seeds the default routine exactly once under concurrent first loads (regression)", async () => {
    const user = await createTestUser("routine-race");
    userIds.push(user.id);
    await Promise.all(Array.from({ length: 6 }, () => getOrCreateDefaultRoutine(user.id)));
    expect(await prisma.routineSection.count({ where: { userId: user.id } })).toBe(DEFAULT_ROUTINE.length);
    const expectedItems = DEFAULT_ROUTINE.reduce((n, s) => n + s.items.length, 0);
    expect(await prisma.routineItem.count({ where: { userId: user.id } })).toBe(expectedItems);
  });
});
