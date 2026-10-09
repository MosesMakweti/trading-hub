"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { requireUser } from "@/server/guards";
import { REFLECTION_MAX } from "@/domain/psychology-reset";
import {
  PsychologyResetError,
  completeReset,
  getPsychologyResetPreference,
  getPsychologyResetState,
  saveResetAnswer,
  setPsychologyResetEnabled,
  setResetDeferred,
  setResetStep,
} from "@/server/services/psychology-reset.service";
import type { PsychologyResetSessionDTO, PsychologyResetStateDTO } from "@/types/psychology-reset";

/**
 * Trading Psychology Reset — server actions. Every action acts on the
 * AUTHENTICATED user only: no userId is ever accepted, and every session id
 * is matched together with that user (another user's id → "not found").
 */

type Result<T> = ({ success: true } & T) | { success: false; error: string };

const sessionId = z.string().min(1).max(64);
const toggleSchema = z.object({ enabled: z.boolean() });
const answerSchema = z.object({
  sessionId,
  stepId: z.string().min(1).max(64),
  optionId: z.string().min(1).max(64),
  note: z.string().max(REFLECTION_MAX, `Keep the reflection under ${REFLECTION_MAX} characters.`).nullish(),
});
const stepSchema = z.object({ sessionId, step: z.number().int().min(0).max(50) });
const deferSchema = z.object({ sessionId, deferred: z.boolean() });
const completeSchema = z.object({ sessionId });

async function run<T>(fn: () => Promise<T>): Promise<Result<{ data: T }>> {
  try {
    return { success: true, data: await fn() };
  } catch (e) {
    if (e instanceof PsychologyResetError) return { success: false, error: e.message };
    throw e;
  }
}

/** The ON/OFF preference. The reply is the PERSISTED value, so the UI never shows an unsaved state as saved. */
export async function setPsychologyResetEnabledAction(input: unknown): Promise<Result<{ enabled: boolean }>> {
  const user = await requireUser();
  const parsed = toggleSchema.safeParse(input);
  if (!parsed.success) return { success: false, error: "Invalid setting." };
  const pref = await setPsychologyResetEnabled(user.id, parsed.data.enabled);
  revalidatePath("/", "layout");
  return { success: true, enabled: pref.enabled };
}

export async function getPsychologyResetPreferenceAction(): Promise<{ enabled: boolean }> {
  const user = await requireUser();
  return { enabled: (await getPsychologyResetPreference(user.id)).enabled };
}

/** The shell's current state (used when the client re-checks after navigation). */
export async function getPsychologyResetStateAction(): Promise<PsychologyResetStateDTO> {
  const user = await requireUser();
  return getPsychologyResetState(user.id);
}

export async function saveResetAnswerAction(input: unknown): Promise<Result<{ data: PsychologyResetSessionDTO }>> {
  const user = await requireUser();
  const parsed = answerSchema.safeParse(input);
  if (!parsed.success) return { success: false, error: parsed.error.issues[0]?.message ?? "Invalid answer." };
  const { sessionId: id, ...answer } = parsed.data;
  return run(() => saveResetAnswer(user.id, id, answer));
}

export async function setResetStepAction(input: unknown): Promise<Result<{ data: PsychologyResetSessionDTO }>> {
  const user = await requireUser();
  const parsed = stepSchema.safeParse(input);
  if (!parsed.success) return { success: false, error: "Invalid step." };
  return run(() => setResetStep(user.id, parsed.data.sessionId, parsed.data.step));
}

export async function setResetDeferredAction(input: unknown): Promise<Result<{ data: PsychologyResetSessionDTO }>> {
  const user = await requireUser();
  const parsed = deferSchema.safeParse(input);
  if (!parsed.success) return { success: false, error: "Invalid request." };
  return run(() => setResetDeferred(user.id, parsed.data.sessionId, parsed.data.deferred));
}

export async function completeResetAction(input: unknown): Promise<Result<{ data: PsychologyResetSessionDTO }>> {
  const user = await requireUser();
  const parsed = completeSchema.safeParse(input);
  if (!parsed.success) return { success: false, error: "Invalid request." };
  return run(() => completeReset(user.id, parsed.data.sessionId));
}
