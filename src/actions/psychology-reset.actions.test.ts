import { afterAll, describe, expect, it, vi } from "vitest";

vi.mock("@/server/guards", () => ({ requireUser: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

import { requireUser } from "@/server/guards";
import { prisma } from "@/server/db";
import { createTestUser, deleteTestUsers } from "@/server/testing/cleanup";
import { currentFlow } from "@/domain/psychology-reset";
import {
  completeResetAction,
  getPsychologyResetPreferenceAction,
  getPsychologyResetStateAction,
  saveResetAnswerAction,
  setPsychologyResetEnabledAction,
  setResetDeferredAction,
  setResetStepAction,
} from "@/actions/psychology-reset.actions";

/** Trading Psychology Reset — server actions: authentication, ownership, validation. */

const userIds: string[] = [];
afterAll(() => deleteTestUsers(...userIds));
const signIn = (id: string) => vi.mocked(requireUser).mockResolvedValue({ id } as Awaited<ReturnType<typeof requireUser>>);

async function user(label: string) {
  const u = await createTestUser(label);
  userIds.push(u.id);
  return u.id;
}

/** A missed-opportunity session for `userId` (inserted directly — the triggers are covered in the service tests). */
async function sessionFor(userId: string) {
  const op = await prisma.tradeOpportunity.create({
    data: { userId, spottedAt: new Date("2026-09-01T00:00:00Z"), assetSymbol: "XAUUSD", direction: "LONG", status: "MISSED", missReason: "HESITATION", missedOutcome: "MISSED_UNDETERMINED" },
  });
  return prisma.psychologyResetSession.create({
    data: { userId, trigger: "MISSED_OPPORTUNITY", opportunityId: op.id, flowVersion: currentFlow("MISSED_OPPORTUNITY").version },
  });
}

describe("authentication", () => {
  const calls: [string, () => Promise<unknown>][] = [
    ["setPsychologyResetEnabledAction", () => setPsychologyResetEnabledAction({ enabled: true })],
    ["getPsychologyResetPreferenceAction", () => getPsychologyResetPreferenceAction()],
    ["getPsychologyResetStateAction", () => getPsychologyResetStateAction()],
    ["saveResetAnswerAction", () => saveResetAnswerAction({ sessionId: "x", stepId: "a", optionId: "b" })],
    ["setResetStepAction", () => setResetStepAction({ sessionId: "x", step: 0 })],
    ["setResetDeferredAction", () => setResetDeferredAction({ sessionId: "x", deferred: true })],
    ["completeResetAction", () => completeResetAction({ sessionId: "x" })],
  ];
  it.each(calls)("%s requires a signed-in user", async (_name, call) => {
    vi.mocked(requireUser).mockImplementation(async () => {
      throw new Error("NEXT_REDIRECT");
    });
    await expect(call()).rejects.toThrow("NEXT_REDIRECT");
  });
});

describe("preference", () => {
  it("defaults OFF, returns the persisted value, is per user, and ignores a smuggled userId", async () => {
    const a = await user("pra-a");
    const b = await user("pra-b");
    signIn(a);
    expect(await getPsychologyResetPreferenceAction()).toEqual({ enabled: false });
    expect(await setPsychologyResetEnabledAction({ enabled: true, userId: b })).toEqual({ success: true, enabled: true });
    expect(await getPsychologyResetPreferenceAction()).toEqual({ enabled: true });
    signIn(b);
    expect(await getPsychologyResetPreferenceAction()).toEqual({ enabled: false });
    expect(await setPsychologyResetEnabledAction({ enabled: "yes" })).toEqual({ success: false, error: "Invalid setting." });
  });
});

describe("sessions", () => {
  it("the owner can answer, navigate, defer and complete; validation errors come back cleanly", async () => {
    const a = await user("pra-owner");
    signIn(a);
    await setPsychologyResetEnabledAction({ enabled: true });
    const s = await sessionFor(a);
    const state = await getPsychologyResetStateAction();
    expect(state.session?.id).toBe(s.id);

    expect(await saveResetAnswerAction({ sessionId: s.id, stepId: "accept_missed", optionId: "nope" })).toEqual({ success: false, error: "Choose one of the answers." });
    expect((await saveResetAnswerAction({ sessionId: s.id, stepId: "accept_missed", optionId: "x".repeat(65) })).success).toBe(false);
    expect((await saveResetAnswerAction({ sessionId: s.id, stepId: "accept_missed", optionId: "hesitated", note: "x".repeat(501) })).success).toBe(false);

    for (const [stepId, optionId] of [
      ["accept_missed", "hesitated"],
      ["release_regret", "make_up_profit"],
      ["new_event", "no_setup"],
      ["next_action", "take_break"],
    ]) {
      expect((await saveResetAnswerAction({ sessionId: s.id, stepId, optionId })).success).toBe(true);
    }
    const back = await setResetStepAction({ sessionId: s.id, step: 1 });
    expect(back.success && back.data.currentStep).toBe(1);
    const deferred = await setResetDeferredAction({ sessionId: s.id, deferred: true });
    expect(deferred.success && deferred.data.deferred).toBe(true);
    const done = await completeResetAction({ sessionId: s.id });
    expect(done.success && done.data).toMatchObject({ status: "COMPLETED", nextAction: "take_break", deferred: false });
    expect(done.success && done.data.assessment.recommendation).toBe("COOLDOWN");
    // No trade and no loss were ever created for a missed opportunity.
    expect(await prisma.trade.count({ where: { userId: a } })).toBe(0);
  });

  it("another user's session id is 'not found' for every action, and their state never shows it", async () => {
    const owner = await user("pra-owner2");
    const intruder = await user("pra-intruder");
    const s = await sessionFor(owner);
    signIn(intruder);
    await setPsychologyResetEnabledAction({ enabled: true });
    expect((await getPsychologyResetStateAction()).session).toBeNull();
    const notFound = { success: false, error: "Reset not found." };
    expect(await saveResetAnswerAction({ sessionId: s.id, stepId: "accept_missed", optionId: "hesitated" })).toEqual(notFound);
    expect(await setResetStepAction({ sessionId: s.id, step: 0 })).toEqual(notFound);
    expect(await setResetDeferredAction({ sessionId: s.id, deferred: true })).toEqual(notFound);
    expect(await completeResetAction({ sessionId: s.id })).toEqual(notFound);
    expect((await prisma.psychologyResetSession.findUniqueOrThrow({ where: { id: s.id } })).answers).toEqual({});
  });
});
