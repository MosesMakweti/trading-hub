/**
 * Backtesting session library — one list of everything the trader has
 * replayed: Strategy Lab accounts, Prop Firm accounts and legacy Backtest
 * Runs, with rename, duplicate, archive/restore and delete.
 *
 * Every operation is owner-scoped (a session that isn't the user's is
 * indistinguishable from a missing one).
 *
 * What is kept on purpose:
 * - Archive is a flag (`archivedAt`); it never changes the session's own
 *   status, so restore puts it back exactly as it was.
 * - Prop Firm accounts are financial records (challenge fees, breaches,
 *   payouts — append-only in the database): they can be archived, never
 *   deleted.
 * - Deleting a Lab account removes its orders, fills, ledger, events and
 *   drawings with it; Study observations made in it are kept (their link to
 *   the account is cleared), because the study is the research record.
 */
import type { BacktestRun, SimAccount } from "@prisma/client";

import { prisma } from "@/server/db";
import { createSimAccount, requireSimAccount, SimError } from "./sim-account.service";
import { parseRules } from "@/domain/simulation/rules";
import { formatWallClock } from "@/domain/native-replay/wall-clock";
import { deleteBacktestRun, requireBacktestRun } from "@/server/services/backtest-run.service";

export { applyLibraryQuery, type LibraryQuery, type LibrarySession, type SessionCounts, type SessionKind } from "@/domain/simulation/session-library";
import type { LibraryQuery, LibrarySession, SessionCounts, SessionKind } from "@/domain/simulation/session-library";
import { applyLibraryQuery } from "@/domain/simulation/session-library";

const dateKey = (d: Date) => d.toISOString().slice(0, 10);
const isArchivedSim = (a: Pick<SimAccount, "archivedAt" | "status">) => a.archivedAt != null || a.status === "ARCHIVED";

const PROP_DELETE_NOTE = "Prop Firm accounts are financial records (fees, breaches, payouts) and can be archived but not deleted.";

async function simCounts(userId: string, ids: string[]): Promise<Map<string, SessionCounts>> {
  const m = new Map<string, SessionCounts>(ids.map((id) => [id, { trades: 0, orders: 0, drawings: 0, observations: 0 }]));
  if (!ids.length) return m;
  const [positions, orders, drawings, observations] = await Promise.all([
    prisma.simPosition.groupBy({ by: ["accountId"], where: { userId, accountId: { in: ids } }, _count: { _all: true } }),
    prisma.simOrder.groupBy({ by: ["accountId"], where: { userId, accountId: { in: ids } }, _count: { _all: true } }),
    prisma.simChartDrawing.groupBy({ by: ["accountId"], where: { userId, accountId: { in: ids } }, _count: { _all: true } }),
    prisma.simObservation.groupBy({ by: ["accountId"], where: { userId, accountId: { in: ids } }, _count: { _all: true } }),
  ]);
  for (const r of positions) m.get(r.accountId)!.trades = r._count._all;
  for (const r of orders) m.get(r.accountId)!.orders = r._count._all;
  for (const r of drawings) m.get(r.accountId)!.drawings = r._count._all;
  for (const r of observations) if (r.accountId) m.get(r.accountId)!.observations = r._count._all;
  return m;
}

async function runCounts(userId: string, ids: string[]): Promise<Map<string, SessionCounts>> {
  const m = new Map<string, SessionCounts>(ids.map((id) => [id, { trades: 0, orders: 0, drawings: 0, observations: 0 }]));
  if (!ids.length) return m;
  const [trades, drawings] = await Promise.all([
    prisma.trade.groupBy({ by: ["backtestRunId"], where: { userId, backtestRunId: { in: ids } }, _count: { _all: true } }),
    prisma.replayChartDrawing.groupBy({ by: ["backtestRunId"], where: { userId, backtestRunId: { in: ids } }, _count: { _all: true } }),
  ]);
  for (const r of trades) if (r.backtestRunId) m.get(r.backtestRunId)!.trades = r._count._all;
  for (const r of drawings) m.get(r.backtestRunId)!.drawings = r._count._all;
  return m;
}

function fromAccount(a: SimAccount, counts: SessionCounts): LibrarySession {
  const prop = a.product === "PROP_FIRM";
  return {
    kind: prop ? "PROP" : "LAB",
    id: a.id,
    name: a.name,
    status: a.status === "ARCHIVED" ? "ARCHIVED" : a.status,
    archived: isArchivedSim(a),
    assets: a.assets,
    periodStart: dateKey(a.periodStart),
    periodEnd: dateKey(a.periodEnd),
    clock: a.currentMinute != null ? formatWallClock(a.currentMinute) : null,
    createdAt: a.createdAt.toISOString(),
    updatedAt: a.updatedAt.toISOString(),
    counts,
    href: `/backtesting/terminal/${a.id}`,
    can: { rename: true, duplicate: !prop, archive: true, delete: !prop },
    deleteNote: prop ? PROP_DELETE_NOTE : null,
  };
}

function fromRun(r: BacktestRun, counts: SessionCounts): LibrarySession {
  return {
    kind: "LEGACY",
    id: r.id,
    name: r.name,
    status: r.status,
    archived: r.archivedAt != null || r.status === "ARCHIVED",
    assets: r.assets,
    periodStart: dateKey(r.startDate),
    periodEnd: dateKey(r.endDate),
    clock: null,
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
    counts,
    href: `/backtesting/${r.id}`,
    can: { rename: true, duplicate: false, archive: true, delete: true },
    deleteNote: null,
  };
}

export async function listLibrary(userId: string, query: LibraryQuery = {}): Promise<LibrarySession[]> {
  const [accounts, runs] = await Promise.all([prisma.simAccount.findMany({ where: { userId } }), prisma.backtestRun.findMany({ where: { userId } })]);
  const [ac, rc] = await Promise.all([simCounts(userId, accounts.map((a) => a.id)), runCounts(userId, runs.map((r) => r.id))]);
  const all = [...accounts.map((a) => fromAccount(a, ac.get(a.id)!)), ...runs.map((r) => fromRun(r, rc.get(r.id)!))];
  return applyLibraryQuery(all, query);
}

async function requireKind(userId: string, kind: SessionKind, id: string): Promise<SimAccount | BacktestRun> {
  if (kind === "LEGACY") return requireBacktestRun(userId, id);
  const a = await requireSimAccount(userId, id);
  if ((a.product === "PROP_FIRM") !== (kind === "PROP")) throw new SimError("Session not found.");
  return a;
}

export async function renameSession(userId: string, kind: SessionKind, id: string, name: string): Promise<void> {
  const clean = name.trim();
  if (!clean || clean.length > 120) throw new SimError("A name needs 1–120 characters.");
  await requireKind(userId, kind, id);
  if (kind === "LEGACY") await prisma.backtestRun.update({ where: { id }, data: { name: clean } });
  else await prisma.simAccount.update({ where: { id }, data: { name: clean } });
}

/** What a delete would remove — for the confirmation. */
export async function deletionImpact(userId: string, kind: SessionKind, id: string): Promise<SessionCounts & { allowed: boolean; note: string | null }> {
  await requireKind(userId, kind, id);
  const counts = (kind === "LEGACY" ? await runCounts(userId, [id]) : await simCounts(userId, [id])).get(id)!;
  return { ...counts, allowed: kind !== "PROP", note: kind === "PROP" ? PROP_DELETE_NOTE : null };
}

export async function setSessionArchived(userId: string, kind: SessionKind, id: string, archived: boolean): Promise<void> {
  const row = await requireKind(userId, kind, id);
  if (kind === "LEGACY") {
    const run = row as BacktestRun;
    // Legacy runs keep archive in their status: restore to COMPLETED (read-only) unless it was never archived by status.
    await prisma.backtestRun.update({
      where: { id },
      data: archived ? { status: "ARCHIVED", archivedAt: run.archivedAt ?? new Date() } : { status: run.status === "ARCHIVED" ? "COMPLETED" : run.status, archivedAt: null },
    });
    return;
  }
  const a = row as SimAccount;
  if (archived) {
    if (a.archivedAt) return;
    await prisma.simAccount.update({ where: { id }, data: { archivedAt: new Date() } });
    return;
  }
  // Older archives also set status ARCHIVED (Lab only): restore a status that matches the account's history.
  const status = a.status === "ARCHIVED" ? (a.endedAt ? "COMPLETED" : a.currentMinute != null ? "ACTIVE" : "CREATED") : a.status;
  await prisma.simAccount.update({ where: { id }, data: { archivedAt: null, status } });
}

/** A fresh Lab account with the same instruments, data, period, balance, rules and strategy — no trades, clock not started. */
export async function duplicateLabAccount(userId: string, id: string, name?: string): Promise<SimAccount> {
  const a = await requireSimAccount(userId, id);
  if (a.product !== "STRATEGY_LAB") throw new SimError("Only Strategy Lab backtests can be duplicated.");
  const pins = await prisma.simDatasetPin.findMany({ where: { userId, accountId: a.id }, select: { assetSymbol: true, datasetId: true } });
  return createSimAccount(userId, {
    product: "STRATEGY_LAB",
    kind: "LAB",
    name: (name?.trim() || `${a.name} (copy)`).slice(0, 120),
    description: a.description,
    strategyId: a.strategyId,
    datasets: pins,
    periodStart: dateKey(a.periodStart),
    periodEnd: dateKey(a.periodEnd),
    startingBalance: Number(a.startingBalance),
    currency: a.currency,
    rules: parseRules(a.rules),
  });
}

export async function deleteSession(userId: string, kind: SessionKind, id: string): Promise<void> {
  await requireKind(userId, kind, id);
  if (kind === "PROP") throw new SimError(PROP_DELETE_NOTE);
  if (kind === "LEGACY") {
    await deleteBacktestRun(userId, id);
    return;
  }
  await prisma.simAccount.delete({ where: { id } });
}
