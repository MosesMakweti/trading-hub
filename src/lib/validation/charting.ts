import { z } from "zod";

import { drawingSchema } from "@/lib/validation/native-replay";

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
export const simDrawingListSchema = z.object({ accountId: id, assetSymbol: z.string().trim().toUpperCase().min(1).max(20) });
export const simDrawingSaveSchema = z.object({ accountId: id, drawing: drawingSchema });
export const simDrawingDeleteSchema = simDrawingListSchema.extend({ drawingId: z.string().min(1).max(64) });

const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Use HH:mm (24-hour).");
export const tradingSessionSchema = z.object({
  name: z.string().trim().min(1, "Name the session.").max(60),
  start: hhmm,
  end: hhmm,
  timeZone: z.string().trim().min(1).max(64),
  days: z.array(z.number().int().min(0).max(6)).min(1, "Pick at least one day.").max(7),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/).default("#8ab4f8"),
  description: z.string().trim().max(280).nullish(),
  enabled: z.boolean().default(true),
});
export const updateTradingSessionSchema = z.object({ id, session: tradingSessionSchema });
export const tradingSessionRefSchema = z.object({ id });
