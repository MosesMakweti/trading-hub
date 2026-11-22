"use server";

import { revalidatePath } from "next/cache";

import { requireUser } from "@/server/guards";
import { observationSchema, setupSchema, studySchema, studyStatusSchema } from "@/lib/validation/simulation";
import { SimError, SimNotFoundError } from "@/server/services/simulation/sim-account.service";
import * as studies from "@/server/services/simulation/sim-study.service";

type Fail = { success: false; error: string };
type Ok<T> = { success: true } & T;

function fail(error: unknown, fallback: string): Fail {
  if (error instanceof SimError || error instanceof SimNotFoundError || error instanceof studies.SimStudyNotFoundError) return { success: false, error: error.message };
  console.error("[simulation-study.actions]", error);
  return { success: false, error: fallback };
}
const invalid = (e: { issues: { message: string }[] }): Fail => ({ success: false, error: e.issues[0]?.message ?? "Invalid input." });
const revalidateStudies = (studyId?: string) => {
  revalidatePath("/backtesting/lab/studies");
  if (studyId) revalidatePath(`/backtesting/lab/studies/${studyId}`);
};

export async function createStudyAction(input: unknown): Promise<Ok<{ id: string }> | Fail> {
  const user = await requireUser();
  const parsed = studySchema.safeParse(input);
  if (!parsed.success) return invalid(parsed.error);
  try {
    const study = await studies.createStudy(user.id, parsed.data);
    revalidateStudies();
    return { success: true, id: study.id };
  } catch (e) {
    return fail(e, "Couldn't create the study.");
  }
}

export async function updateStudyAction(studyId: unknown, input: unknown): Promise<Ok<object> | Fail> {
  const user = await requireUser();
  const parsed = studySchema.safeParse(input);
  if (!parsed.success) return invalid(parsed.error);
  if (typeof studyId !== "string" || !studyId) return { success: false, error: "Study not found." };
  try {
    await studies.updateStudy(user.id, studyId, parsed.data);
    revalidateStudies(studyId);
    return { success: true };
  } catch (e) {
    return fail(e, "Couldn't save the study.");
  }
}

export async function setStudyStatusAction(input: unknown): Promise<Ok<object> | Fail> {
  const user = await requireUser();
  const parsed = studyStatusSchema.safeParse(input);
  if (!parsed.success) return invalid(parsed.error);
  try {
    await studies.setStudyStatus(user.id, parsed.data.studyId, parsed.data.status);
    revalidateStudies(parsed.data.studyId);
    return { success: true };
  } catch (e) {
    return fail(e, "Couldn't update the study.");
  }
}

export async function addSetupAction(input: unknown): Promise<Ok<{ id: string }> | Fail> {
  const user = await requireUser();
  const parsed = setupSchema.safeParse(input);
  if (!parsed.success) return invalid(parsed.error);
  try {
    const setup = await studies.addSetup(user.id, parsed.data.studyId, parsed.data.name, parsed.data.description);
    revalidateStudies(parsed.data.studyId);
    return { success: true, id: setup.id };
  } catch (e) {
    return fail(e, "Couldn't add the setup.");
  }
}

export async function recordObservationAction(input: unknown): Promise<Ok<{ id: string }> | Fail> {
  const user = await requireUser();
  const parsed = observationSchema.safeParse(input);
  if (!parsed.success) return invalid(parsed.error);
  try {
    const obs = await studies.recordObservation(user.id, parsed.data);
    revalidateStudies(parsed.data.studyId);
    return { success: true, id: obs.id };
  } catch (e) {
    return fail(e, "Couldn't save the observation.");
  }
}

export async function deleteObservationAction(observationId: unknown, studyId: unknown): Promise<Ok<object> | Fail> {
  const user = await requireUser();
  if (typeof observationId !== "string" || !observationId) return { success: false, error: "Observation not found." };
  try {
    await studies.deleteObservation(user.id, observationId);
    revalidateStudies(typeof studyId === "string" ? studyId : undefined);
    return { success: true };
  } catch (e) {
    return fail(e, "Couldn't delete the observation.");
  }
}
