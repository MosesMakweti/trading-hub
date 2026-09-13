import { afterAll, describe, expect, it } from "vitest";

import { prisma } from "@/server/db";
import { createReplayReviewSession, startReplayReviewSession, completeReplayReviewSession, reopenReplayReviewSession } from "@/server/services/replay-review.service";
import {
  clearReplayAnnotations,
  createReplayAnnotation,
  deleteReplayAnnotation,
  listReplayAnnotations,
} from "@/server/services/replay-annotation.service";
import type { CreateReplayAnnotationInput } from "@/lib/validation/replay";

/** Real integration tests against the dev Postgres DB — same pattern as
 *  replay-trade.service.test.ts. */

const userIds: string[] = [];

async function makeUser(label: string) {
  const user = await prisma.user.create({
    data: { email: `replay-annotation-${label}-${Date.now()}-${Math.random().toString(36).slice(2)}@example.com` },
  });
  userIds.push(user.id);
  return user;
}

afterAll(async () => {
  await prisma.user.deleteMany({ where: { id: { in: userIds } } });
});

async function inProgressSession(userId: string) {
  const session = await createReplayReviewSession(userId, { reviewType: "WEEKLY", startDate: "2026-08-03", endDate: "2026-08-09" });
  await startReplayReviewSession(userId, session.id);
  return session;
}

function horizontalLine(sessionId: string, overrides: Partial<CreateReplayAnnotationInput> = {}): CreateReplayAnnotationInput {
  return { sessionId, assetSymbol: "XAUUSD", type: "HORIZONTAL_LINE", geometry: { price: 2400 }, ...overrides } as CreateReplayAnnotationInput;
}

describe("createReplayAnnotation / listReplayAnnotations", () => {
  it("creates and lists a horizontal-line annotation scoped to session+asset", async () => {
    const user = await makeUser("create-list");
    const session = await inProgressSession(user.id);

    const created = await createReplayAnnotation(user.id, horizontalLine(session.id));
    expect(created.type).toBe("HORIZONTAL_LINE");
    expect(created.geometry).toEqual({ price: 2400 });

    const listed = await listReplayAnnotations(user.id, session.id, "XAUUSD");
    expect(listed).toHaveLength(1);
    expect(listed[0].id).toBe(created.id);
  });

  it("creates a trend line with two-point geometry", async () => {
    const user = await makeUser("trend-line");
    const session = await inProgressSession(user.id);
    const geometry = { p1: { time: 1000, price: 1.1 }, p2: { time: 2000, price: 1.2 } };
    const created = await createReplayAnnotation(user.id, {
      sessionId: session.id,
      assetSymbol: "EURUSD",
      type: "TREND_LINE",
      geometry,
    } as CreateReplayAnnotationInput);
    expect(created.geometry).toEqual(geometry);
  });

  it("isolates annotations by asset — a drawing on XAUUSD never appears when listing EURUSD (Stage 18 §42)", async () => {
    const user = await makeUser("isolation-asset");
    const session = await inProgressSession(user.id);
    await createReplayAnnotation(user.id, horizontalLine(session.id, { assetSymbol: "XAUUSD" }));
    await createReplayAnnotation(user.id, horizontalLine(session.id, { assetSymbol: "EURUSD", geometry: { price: 1.1 } }));

    const xauList = await listReplayAnnotations(user.id, session.id, "XAUUSD");
    const eurList = await listReplayAnnotations(user.id, session.id, "EURUSD");
    expect(xauList).toHaveLength(1);
    expect(eurList).toHaveLength(1);
    expect(xauList[0].assetSymbol).toBe("XAUUSD");
    expect(eurList[0].assetSymbol).toBe("EURUSD");
  });

  it("isolates annotations by session — a second session never sees the first session's drawings", async () => {
    const user = await makeUser("isolation-session");
    const sessionA = await inProgressSession(user.id);
    const sessionB = await createReplayReviewSession(user.id, { reviewType: "WEEKLY", startDate: "2026-08-10", endDate: "2026-08-16" });
    await startReplayReviewSession(user.id, sessionB.id);

    await createReplayAnnotation(user.id, horizontalLine(sessionA.id));

    expect(await listReplayAnnotations(user.id, sessionA.id, "XAUUSD")).toHaveLength(1);
    expect(await listReplayAnnotations(user.id, sessionB.id, "XAUUSD")).toHaveLength(0);
  });

  it("never leaks one user's drawings to another user's session lookup", async () => {
    const owner = await makeUser("owner");
    const intruder = await makeUser("intruder");
    const session = await inProgressSession(owner.id);
    await createReplayAnnotation(owner.id, horizontalLine(session.id));

    await expect(listReplayAnnotations(intruder.id, session.id, "XAUUSD")).rejects.toThrow(/not found/i);
  });

  it("rejects creating a drawing on a session that isn't IN_PROGRESS (completed-session lock, §35)", async () => {
    const user = await makeUser("completed-lock");
    const session = await inProgressSession(user.id);
    await completeReplayReviewSession(user.id, session.id);

    await expect(createReplayAnnotation(user.id, horizontalLine(session.id))).rejects.toThrow(/completed/i);
  });

  it("still allows VIEWING drawings on a completed session (§36 — drawings remain visible)", async () => {
    const user = await makeUser("completed-view");
    const session = await inProgressSession(user.id);
    await createReplayAnnotation(user.id, horizontalLine(session.id));
    await completeReplayReviewSession(user.id, session.id);

    const listed = await listReplayAnnotations(user.id, session.id, "XAUUSD");
    expect(listed).toHaveLength(1);
  });
});

describe("deleteReplayAnnotation / clearReplayAnnotations", () => {
  it("soft-deletes a single annotation — excluded from subsequent listings", async () => {
    const user = await makeUser("delete-one");
    const session = await inProgressSession(user.id);
    const created = await createReplayAnnotation(user.id, horizontalLine(session.id));

    await deleteReplayAnnotation(user.id, created.id);
    expect(await listReplayAnnotations(user.id, session.id, "XAUUSD")).toHaveLength(0);
  });

  it("clearReplayAnnotations removes only the given session+asset's drawings, never another asset's", async () => {
    const user = await makeUser("clear-scoped");
    const session = await inProgressSession(user.id);
    await createReplayAnnotation(user.id, horizontalLine(session.id, { assetSymbol: "XAUUSD" }));
    await createReplayAnnotation(user.id, horizontalLine(session.id, { assetSymbol: "EURUSD", geometry: { price: 1.1 } }));

    await clearReplayAnnotations(user.id, session.id, "XAUUSD");

    expect(await listReplayAnnotations(user.id, session.id, "XAUUSD")).toHaveLength(0);
    expect(await listReplayAnnotations(user.id, session.id, "EURUSD")).toHaveLength(1);
  });

  it("rejects deleting a drawing on a completed session, and reopening restores the ability", async () => {
    const user = await makeUser("delete-completed-lock");
    const session = await inProgressSession(user.id);
    const created = await createReplayAnnotation(user.id, horizontalLine(session.id));
    await completeReplayReviewSession(user.id, session.id);

    await expect(deleteReplayAnnotation(user.id, created.id)).rejects.toThrow(/completed/i);

    await reopenReplayReviewSession(user.id, session.id);
    await expect(deleteReplayAnnotation(user.id, created.id)).resolves.toBeUndefined();
  });
});
