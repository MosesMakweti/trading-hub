/**
 * Charting persistence: the per-user chart workspace and the Traditorium
 * Script library (with immutable versions).
 *
 * Script source is untrusted text. The server stores it and never parses or
 * runs it — scripts execute only in the browser's Web Worker sandbox. The
 * script kind (indicator / strategy) is read from the declaration with a
 * plain text match.
 */
import { prisma } from "@/server/db";
import { DEFAULT_WORKSPACE, normalizeWorkspace, workspaceSchema, type Workspace } from "@/domain/charting/workspace";

export class ChartingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ChartingError";
  }
}

export const SCRIPT_LIMITS = { sourceBytes: 64 * 1024, scriptsPerUser: 200, versionsKept: 100 } as const;

// ── Workspace ───────────────────────────────────────────────────────────────

export async function getWorkspace(userId: string, key = "sim"): Promise<Workspace> {
  const row = await prisma.chartWorkspace.findUnique({ where: { userId_key: { userId, key } } });
  return row ? normalizeWorkspace(row.data) : DEFAULT_WORKSPACE;
}

export async function saveWorkspace(userId: string, data: unknown, key = "sim"): Promise<Workspace> {
  const parsed = workspaceSchema.safeParse(data);
  if (!parsed.success) throw new ChartingError(parsed.error.issues[0]?.message ?? "Invalid workspace.");
  const ws = normalizeWorkspace(parsed.data);
  // Script studies must reference the user's own scripts.
  const ids = [...new Set(ws.charts.flatMap((c) => c.studies.flatMap((s) => (s.kind === "script" ? [s.scriptId] : []))))];
  if (ids.length) {
    const owned = new Set((await prisma.userScript.findMany({ where: { userId, id: { in: ids } }, select: { id: true } })).map((s) => s.id));
    for (const c of ws.charts) c.studies = c.studies.filter((s) => s.kind !== "script" || owned.has(s.scriptId));
  }
  const json = JSON.parse(JSON.stringify(ws));
  await prisma.chartWorkspace.upsert({ where: { userId_key: { userId, key } }, create: { userId, key, data: json }, update: { data: json } });
  return ws;
}

// ── Scripts ─────────────────────────────────────────────────────────────────

export function scriptKindOf(source: string): "indicator" | "strategy" {
  const code = source.replace(/\/\/.*$/gm, "");
  return /^\s*strategy\s*\(/m.test(code) ? "strategy" : "indicator";
}

function checkSource(source: string) {
  if (new TextEncoder().encode(source).length > SCRIPT_LIMITS.sourceBytes) throw new ChartingError(`Scripts are limited to ${SCRIPT_LIMITS.sourceBytes / 1024} KB.`);
}

export interface ScriptSummary {
  id: string;
  name: string;
  kind: string;
  version: number;
  updatedAt: string;
}

export interface ScriptDetail extends ScriptSummary {
  source: string;
  versions: { version: number; note: string | null; createdAt: string }[];
}

const summary = (s: { id: string; name: string; kind: string; version: number; updatedAt: Date }): ScriptSummary => ({ id: s.id, name: s.name, kind: s.kind, version: s.version, updatedAt: s.updatedAt.toISOString() });

export async function listScripts(userId: string): Promise<ScriptSummary[]> {
  const rows = await prisma.userScript.findMany({ where: { userId, archivedAt: null }, orderBy: { updatedAt: "desc" }, select: { id: true, name: true, kind: true, version: true, updatedAt: true } });
  return rows.map(summary);
}

async function requireScript(userId: string, id: string) {
  const s = await prisma.userScript.findFirst({ where: { id, userId } });
  if (!s) throw new ChartingError("Script not found.");
  return s;
}

export async function getScript(userId: string, id: string): Promise<ScriptDetail> {
  const s = await requireScript(userId, id);
  const versions = await prisma.userScriptVersion.findMany({ where: { scriptId: id }, orderBy: { version: "desc" }, select: { version: true, note: true, createdAt: true } });
  return { ...summary(s), source: s.source, versions: versions.map((v) => ({ version: v.version, note: v.note, createdAt: v.createdAt.toISOString() })) };
}

/** Sources of several of the user's scripts (for running them on charts). */
export async function getScriptSources(userId: string, ids: string[]): Promise<{ id: string; name: string; kind: string; version: number; source: string }[]> {
  if (!ids.length) return [];
  return prisma.userScript.findMany({ where: { userId, id: { in: ids.slice(0, 48) } }, select: { id: true, name: true, kind: true, version: true, source: true } });
}

export async function createScript(userId: string, name: string, source: string): Promise<ScriptSummary> {
  checkSource(source);
  const count = await prisma.userScript.count({ where: { userId, archivedAt: null } });
  if (count >= SCRIPT_LIMITS.scriptsPerUser) throw new ChartingError(`You can keep up to ${SCRIPT_LIMITS.scriptsPerUser} scripts. Archive some first.`);
  const s = await prisma.userScript.create({
    data: { userId, name, source, kind: scriptKindOf(source), version: 1, versions: { create: { version: 1, source, note: "Created" } } },
  });
  return summary(s);
}

/**
 * Saves a new version. `baseVersion` is the version the editor loaded: if
 * another tab saved since, the save is refused instead of silently
 * overwriting it.
 */
export async function saveScript(userId: string, id: string, source: string, baseVersion: number, note?: string | null): Promise<ScriptSummary> {
  checkSource(source);
  return prisma.$transaction(async (tx) => {
    const s = await tx.userScript.findFirst({ where: { id, userId } });
    if (!s) throw new ChartingError("Script not found.");
    if (s.archivedAt) throw new ChartingError("This script is archived. Restore it before editing.");
    if (s.version !== baseVersion) throw new ChartingError(`This script was saved elsewhere (now version ${s.version}). Reload it before saving.`);
    if (s.source === source) return summary(s);
    const version = s.version + 1;
    const updated = await tx.userScript.updateMany({ where: { id, userId, version: s.version }, data: { source, version, kind: scriptKindOf(source) } });
    if (updated.count !== 1) throw new ChartingError("This script was saved elsewhere. Reload it before saving.");
    await tx.userScriptVersion.create({ data: { scriptId: id, version, source, note: note ?? null } });
    const old = await tx.userScriptVersion.findMany({ where: { scriptId: id }, orderBy: { version: "desc" }, skip: SCRIPT_LIMITS.versionsKept, select: { id: true } });
    if (old.length) await tx.userScriptVersion.deleteMany({ where: { id: { in: old.map((o) => o.id) } } });
    return summary((await tx.userScript.findUnique({ where: { id } }))!);
  });
}

export async function getScriptVersion(userId: string, id: string, version: number): Promise<string> {
  await requireScript(userId, id);
  const v = await prisma.userScriptVersion.findUnique({ where: { scriptId_version: { scriptId: id, version } } });
  if (!v) throw new ChartingError("That version no longer exists.");
  return v.source;
}

/** Restoring an old version saves it as a new version (history is never rewritten). */
export async function restoreScriptVersion(userId: string, id: string, version: number): Promise<ScriptSummary> {
  const source = await getScriptVersion(userId, id, version);
  const s = await requireScript(userId, id);
  return saveScript(userId, id, source, s.version, `Restored version ${version}`);
}

export async function renameScript(userId: string, id: string, name: string): Promise<void> {
  const r = await prisma.userScript.updateMany({ where: { id, userId }, data: { name } });
  if (r.count !== 1) throw new ChartingError("Script not found.");
}

export async function duplicateScript(userId: string, id: string): Promise<ScriptSummary> {
  const s = await requireScript(userId, id);
  return createScript(userId, `${s.name} (copy)`.slice(0, 80), s.source);
}

export async function setScriptArchived(userId: string, id: string, archived: boolean): Promise<void> {
  const r = await prisma.userScript.updateMany({ where: { id, userId }, data: { archivedAt: archived ? new Date() : null } });
  if (r.count !== 1) throw new ChartingError("Script not found.");
}
