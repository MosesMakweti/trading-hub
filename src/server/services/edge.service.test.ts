import { afterAll, describe, expect, it } from "vitest";

import { prisma } from "@/server/db";
import { getWeeklyReview, upsertWeeklyReview } from "@/server/services/edge.service";

const userIds: string[] = [];

async function makeUser(label: string) {
  const user = await prisma.user.create({
    data: { email: `edge-service-${label}-${Date.now()}-${Math.random().toString(36).slice(2)}@example.com` },
  });
  userIds.push(user.id);
  return user;
}

afterAll(async () => {
  await prisma.user.deleteMany({ where: { id: { in: userIds } } });
});

describe("Edge Review reflection — Improvements stage (Stage 12.5 §14)", () => {
  it("persists and reads back a weekly reflection", async () => {
    const user = await makeUser("weekly-persist");
    await upsertWeeklyReview(user.id, "2026-08-03", "WEEKLY", {
      wentWell: { type: "doc", content: [{ type: "text", text: "Stuck to the plan." }] },
    });

    const review = await getWeeklyReview(user.id, "2026-08-03", "WEEKLY");
    expect(review).not.toBeNull();
    expect(review?.reviewType).toBe("WEEKLY");
  });

  it("defaults to WEEKLY when no reviewType is given", async () => {
    const user = await makeUser("default-type");
    await upsertWeeklyReview(user.id, "2026-08-03", "WEEKLY", { toImprove: { type: "doc", content: [] } });
    const review = await getWeeklyReview(user.id, "2026-08-03");
    expect(review?.reviewType).toBe("WEEKLY");
  });

  it("keeps a WEEKLY and a MONTHLY reflection separate even when their period-start dates coincide", async () => {
    const user = await makeUser("weekly-monthly-collision");
    // 2027-02-01 is a Monday — both a valid week-start and a month-start.
    await upsertWeeklyReview(user.id, "2027-02-01", "WEEKLY", {
      focusNextWeek: { type: "doc", content: [{ type: "text", text: "Weekly focus." }] },
    });
    await upsertWeeklyReview(user.id, "2027-02-01", "MONTHLY", {
      focusNextWeek: { type: "doc", content: [{ type: "text", text: "Monthly focus." }] },
    });

    const weekly = await getWeeklyReview(user.id, "2027-02-01", "WEEKLY");
    const monthly = await getWeeklyReview(user.id, "2027-02-01", "MONTHLY");
    expect(weekly?.id).not.toBe(monthly?.id);
    expect(weekly?.focusNextWeek).toEqual({ type: "doc", content: [{ type: "text", text: "Weekly focus." }] });
    expect(monthly?.focusNextWeek).toEqual({ type: "doc", content: [{ type: "text", text: "Monthly focus." }] });
  });

  it("preserves existing reflection values when a different field is patched", async () => {
    const user = await makeUser("preserve-fields");
    await upsertWeeklyReview(user.id, "2026-08-03", "WEEKLY", {
      wentWell: { type: "doc", content: [{ type: "text", text: "Went well." }] },
    });
    await upsertWeeklyReview(user.id, "2026-08-03", "WEEKLY", {
      toImprove: { type: "doc", content: [{ type: "text", text: "To improve." }] },
    });

    const review = await getWeeklyReview(user.id, "2026-08-03", "WEEKLY");
    expect(review?.wentWell).toEqual({ type: "doc", content: [{ type: "text", text: "Went well." }] });
    expect(review?.toImprove).toEqual({ type: "doc", content: [{ type: "text", text: "To improve." }] });
  });

  it("never leaks one user's reflection to another user", async () => {
    const owner = await makeUser("reflection-owner");
    const other = await makeUser("reflection-other");
    await upsertWeeklyReview(owner.id, "2026-08-03", "WEEKLY", { wentWell: { type: "doc", content: [] } });

    expect(await getWeeklyReview(other.id, "2026-08-03", "WEEKLY")).toBeNull();
  });
});
