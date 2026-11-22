"use server";

import { requireUser } from "@/server/guards";
import type { Workspace } from "@/domain/charting/workspace";
import {
  archiveScriptSchema,
  createScriptSchema,
  renameScriptSchema,
  saveScriptSchema,
  scriptRefSchema,
  scriptSourcesSchema,
  scriptVersionSchema,
} from "@/lib/validation/charting";
import * as charting from "@/server/services/charting/charting.service";

type Fail = { success: false; error: string };
type Ok<T> = { success: true } & T;

function fail(error: unknown, fallback: string): Fail {
  if (error instanceof charting.ChartingError) return { success: false, error: error.message };
  console.error("[charting.actions]", error);
  return { success: false, error: fallback };
}
const invalid = (e: { issues: { message: string }[] }): Fail => ({ success: false, error: e.issues[0]?.message ?? "Invalid input." });

export async function saveWorkspaceAction(input: unknown): Promise<Ok<{ workspace: Workspace }> | Fail> {
  const user = await requireUser();
  try {
    return { success: true, workspace: await charting.saveWorkspace(user.id, input) };
  } catch (e) {
    return fail(e, "Couldn't save the chart layout.");
  }
}

export async function listScriptsAction(): Promise<Ok<{ scripts: charting.ScriptSummary[] }> | Fail> {
  const user = await requireUser();
  try {
    return { success: true, scripts: await charting.listScripts(user.id) };
  } catch (e) {
    return fail(e, "Couldn't load your scripts.");
  }
}

export async function getScriptAction(input: unknown): Promise<Ok<{ script: charting.ScriptDetail }> | Fail> {
  const user = await requireUser();
  const p = scriptRefSchema.safeParse(input);
  if (!p.success) return invalid(p.error);
  try {
    return { success: true, script: await charting.getScript(user.id, p.data.id) };
  } catch (e) {
    return fail(e, "Couldn't open the script.");
  }
}

export async function getScriptSourcesAction(input: unknown): Promise<Ok<{ scripts: Awaited<ReturnType<typeof charting.getScriptSources>> }> | Fail> {
  const user = await requireUser();
  const p = scriptSourcesSchema.safeParse(input);
  if (!p.success) return invalid(p.error);
  try {
    return { success: true, scripts: await charting.getScriptSources(user.id, p.data.ids) };
  } catch (e) {
    return fail(e, "Couldn't load scripts.");
  }
}

export async function createScriptAction(input: unknown): Promise<Ok<{ script: charting.ScriptSummary }> | Fail> {
  const user = await requireUser();
  const p = createScriptSchema.safeParse(input);
  if (!p.success) return invalid(p.error);
  try {
    return { success: true, script: await charting.createScript(user.id, p.data.name, p.data.source) };
  } catch (e) {
    return fail(e, "Couldn't create the script.");
  }
}

export async function saveScriptAction(input: unknown): Promise<Ok<{ script: charting.ScriptSummary }> | Fail> {
  const user = await requireUser();
  const p = saveScriptSchema.safeParse(input);
  if (!p.success) return invalid(p.error);
  try {
    return { success: true, script: await charting.saveScript(user.id, p.data.id, p.data.source, p.data.baseVersion, p.data.note) };
  } catch (e) {
    return fail(e, "Couldn't save the script.");
  }
}

export async function getScriptVersionAction(input: unknown): Promise<Ok<{ source: string }> | Fail> {
  const user = await requireUser();
  const p = scriptVersionSchema.safeParse(input);
  if (!p.success) return invalid(p.error);
  try {
    return { success: true, source: await charting.getScriptVersion(user.id, p.data.id, p.data.version) };
  } catch (e) {
    return fail(e, "Couldn't load that version.");
  }
}

export async function restoreScriptVersionAction(input: unknown): Promise<Ok<{ script: charting.ScriptSummary }> | Fail> {
  const user = await requireUser();
  const p = scriptVersionSchema.safeParse(input);
  if (!p.success) return invalid(p.error);
  try {
    return { success: true, script: await charting.restoreScriptVersion(user.id, p.data.id, p.data.version) };
  } catch (e) {
    return fail(e, "Couldn't restore that version.");
  }
}

export async function renameScriptAction(input: unknown): Promise<Ok<object> | Fail> {
  const user = await requireUser();
  const p = renameScriptSchema.safeParse(input);
  if (!p.success) return invalid(p.error);
  try {
    await charting.renameScript(user.id, p.data.id, p.data.name);
    return { success: true };
  } catch (e) {
    return fail(e, "Couldn't rename the script.");
  }
}

export async function duplicateScriptAction(input: unknown): Promise<Ok<{ script: charting.ScriptSummary }> | Fail> {
  const user = await requireUser();
  const p = scriptRefSchema.safeParse(input);
  if (!p.success) return invalid(p.error);
  try {
    return { success: true, script: await charting.duplicateScript(user.id, p.data.id) };
  } catch (e) {
    return fail(e, "Couldn't duplicate the script.");
  }
}

export async function archiveScriptAction(input: unknown): Promise<Ok<object> | Fail> {
  const user = await requireUser();
  const p = archiveScriptSchema.safeParse(input);
  if (!p.success) return invalid(p.error);
  try {
    await charting.setScriptArchived(user.id, p.data.id, p.data.archived);
    return { success: true };
  } catch (e) {
    return fail(e, "Couldn't archive the script.");
  }
}
