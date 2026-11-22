import { z } from "zod";

const id = z.string().min(1).max(64);
export const scriptName = z.string().trim().min(1, "Name the script.").max(80);
export const scriptSource = z.string().max(70_000);

export const workspaceKeySchema = z.enum(["sim"]).default("sim");
export const createScriptSchema = z.object({ name: scriptName, source: scriptSource });
export const saveScriptSchema = z.object({ id, source: scriptSource, baseVersion: z.number().int().min(1), note: z.string().trim().max(200).nullish() });
export const scriptRefSchema = z.object({ id });
export const scriptVersionSchema = z.object({ id, version: z.number().int().min(1) });
export const renameScriptSchema = z.object({ id, name: scriptName });
export const archiveScriptSchema = z.object({ id, archived: z.boolean() });
export const scriptSourcesSchema = z.object({ ids: z.array(id).max(48) });
export const pointValueSchema = z.object({ accountId: id, symbol: z.string().trim().toUpperCase().min(1).max(20) });
