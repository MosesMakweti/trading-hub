/**
 * The trader's own session definitions (CRUD). Each is validated on the
 * server (time format, a real IANA zone, weekdays) and only its owner can
 * read or change it.
 */
import { prisma } from "@/server/db";
import { isValidTimeZone, type SessionDef } from "@/domain/charting/sessions";
import { ChartingError } from "./charting.service";

export const MAX_SESSIONS = 50;

export interface SessionInput {
  name: string;
  start: string;
  end: string;
  timeZone: string;
  days: number[];
  color: string;
  description?: string | null;
  enabled: boolean;
}

function check(input: SessionInput) {
  if (!isValidTimeZone(input.timeZone)) throw new ChartingError(`"${input.timeZone}" isn't a time zone we recognise.`);
  if (input.start === input.end) throw new ChartingError("A session needs different start and end times.");
}

const toDef = (r: { id: string; name: string; start: string; end: string; timeZone: string; days: number[]; color: string; description: string | null; enabled: boolean }): SessionDef => ({
  id: r.id,
  name: r.name,
  start: r.start,
  end: r.end,
  timeZone: r.timeZone,
  days: r.days,
  color: r.color,
  description: r.description,
  enabled: r.enabled,
});

export async function listTradingSessions(userId: string): Promise<SessionDef[]> {
  return (await prisma.userTradingSession.findMany({ where: { userId }, orderBy: { createdAt: "asc" } })).map(toDef);
}

export async function createTradingSession(userId: string, input: SessionInput): Promise<SessionDef> {
  check(input);
  if ((await prisma.userTradingSession.count({ where: { userId } })) >= MAX_SESSIONS) throw new ChartingError(`You can keep up to ${MAX_SESSIONS} sessions.`);
  return toDef(await prisma.userTradingSession.create({ data: { userId, ...input, days: [...new Set(input.days)].sort() } }));
}

export async function updateTradingSession(userId: string, id: string, input: SessionInput): Promise<SessionDef> {
  check(input);
  const r = await prisma.userTradingSession.updateMany({ where: { id, userId }, data: { ...input, days: [...new Set(input.days)].sort() } });
  if (r.count !== 1) throw new ChartingError("Session not found.");
  return toDef(await prisma.userTradingSession.findUniqueOrThrow({ where: { id } }));
}

export async function deleteTradingSession(userId: string, id: string): Promise<void> {
  const r = await prisma.userTradingSession.deleteMany({ where: { id, userId } });
  if (r.count !== 1) throw new ChartingError("Session not found.");
}
