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
import { createSimAccount, requireSimAccount, SimError, SimNotFoundError } from "./sim-account.service";
import { parseRules } from "@/domain/simulation/rules";
import { formatWallClock } from "@/domain/native-replay/wall-clock";
import { deleteBacktestRun, requireBacktestRun } from "@/server/services/backtest-run.service";

export { applyLibraryQuery, type LibraryQuery, type LibrarySession, type SessionCounts, type SessionKind, type SessionPerformance } from "@/domain/simulation/session-library";
import type { LibraryQuery, LibrarySession, SessionCounts, SessionKind, SessionPerformance } from "@/domain/simulation/session-library";
import { applyLibraryQuery } from "@/domain/simulation/session-library";

const dateKey = (d: Date) => d.toISOString().slice(0, 10);
const isArchivedSim = (a: Pick<SimAccount, "archivedAt" | "status">) => a.archivedAt != null || a.status === "ARCHIVED";

/** A Prop Firm session is one stage of a challenge: deleting it deletes the whole challenge (every stage). */
const propNote = (stages: number) => (stages > 1 ? `Deletes the whole challenge — all ${stages} of its accounts (evaluation phases and funded), with their trades and history.` : "Deletes the challenge with its trades and history.");

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

/** Net result (ledger), closed trades, wins and open positions per account. */
async function simPerformance(userId: string, accounts: SimAccount[]): Promise<Map<string, SessionPerformance>> {
  const m = new Map<string, SessionPerformance>();
  const ids = accounts.map((a) => a.id);
  if (!ids.length) return m;
  const [balances, byStatus, wins] = await Promise.all([
    prisma.$queryRaw<{ accountId: string; balance: string }[]>`
      SELECT DISTINCT ON ("accountId") "accountId", "balanceAfter"::text AS balance
      FROM "SimLedgerEntry" WHERE "accountId" = ANY(${ids}::text[]) AND "userId" = ${userId}
      ORDER BY "accountId", "sequence" DESC`,
    prisma.simPosition.groupBy({ by: ["accountId", "status"], where: { userId, accountId: { in: ids } }, _count: { _all: true } }),
    prisma.simPosition.groupBy({ by: ["accountId"], where: { userId, accountId: { in: ids }, status: "CLOSED", realizedPnl: { gt: 0 } }, _count: { _all: true } }),
  ]);
  const bal = new Map(balances.map((b) => [b.accountId, Number(b.balance)]));
  for (const a of accounts) {
    const start = Number(a.startingBalance);
    const rows = byStatus.filter((r) => r.accountId === a.id);
    m.set(a.id, {
      currency: a.currency,
      netResult: Math.round(((bal.get(a.id) ?? start) - start) * 100) / 100,
      closedTrades: rows.find((r) => r.status === "CLOSED")?._count._all ?? 0,
      openPositions: rows.find((r) => r.status === "OPEN")?._count._all ?? 0,
      wins: wins.find((w) => w.accountId === a.id)?._count._all ?? 0,
    });
  }
  return m;
}

function fromAccount(a: SimAccount, counts: SessionCounts, performance: SessionPerformance | null = null, challengeStages = 1): LibrarySession {
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
    performance,
    href: `/backtesting/terminal/${a.id}`,
    can: { rename: true, duplicate: !prop, archive: true, delete: true },
    deleteNote: prop ? propNote(challengeStages) : null,
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
    performance: null,
    href: `/backtesting/${r.id}`,
    can: { rename: true, duplicate: false, archive: true, delete: true },
    deleteNote: null,
  };
}

export async function listLibrary(userId: string, query: LibraryQuery = {}): Promise<LibrarySession[]> {
  const [accounts, runs] = await Promise.all([prisma.simAccount.findMany({ where: { userId } }), prisma.backtestRun.findMany({ where: { userId } })]);
  const [ac, rc, perf] = await Promise.all([simCounts(userId, accounts.map((a) => a.id)), runCounts(userId, runs.map((r) => r.id)), simPerformance(userId, accounts)]);
  const stages = new Map<string, number>();
  for (const a of accounts) if (a.challengeId) stages.set(a.challengeId, (stages.get(a.challengeId) ?? 0) + 1);
  const all = [...accounts.map((a) => fromAccount(a, ac.get(a.id)!, perf.get(a.id) ?? null, a.challengeId ? stages.get(a.challengeId) : 1)), ...runs.map((r) => fromRun(r, rc.get(r.id)!))];
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
  const row = await requireKind(userId, kind, id);
  if (kind === "PROP") {
    // The whole challenge goes: count every stage.
    const ids = await challengeAccountIds(userId, row as SimAccount);
    const per = await simCounts(userId, ids);
    const sum = [...per.values()].reduce((t, c) => ({ trades: t.trades + c.trades, orders: t.orders + c.orders, drawings: t.drawings + c.drawings, observations: t.observations + c.observations }), { trades: 0, orders: 0, drawings: 0, observations: 0 });
    return { ...sum, allowed: true, note: propNote(ids.length) };
  }
  const counts = (kind === "LEGACY" ? await runCounts(userId, [id]) : await simCounts(userId, [id])).get(id)!;
  return { ...counts, allowed: true, note: null };
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
  const row = await requireKind(userId, kind, id);
  if (kind === "PROP") {
    await deletePropChallenge(userId, row as SimAccount);
    return;
  }
  if (kind === "LEGACY") {
    await deleteBacktestRun(userId, id);
    return;
  }
  // Owner in the WHERE as well: even a race can't delete someone else's row.
  // One statement; the database cascades orders, fills, positions, ledger,
  // events, pins and drawings atomically (observations are unlinked, kept).
  const r = await prisma.simAccount.deleteMany({ where: { id, userId, product: "STRATEGY_LAB" } });
  if (r.count !== 1) throw new SimNotFoundError();
}

export interface SessionRef {
  kind: SessionKind;
  id: string;
}

export const MAX_BULK = 100;

/** Every ref must be the user's (and match its kind) — checked before anything changes. */
async function requireAll(userId: string, refs: SessionRef[]): Promise<SessionRef[]> {
  const unique = [...new Map(refs.map((r) => [`${r.kind}:${r.id}`, r])).values()];
  if (unique.length === 0) throw new SimError("Select at least one session.");
  if (unique.length > MAX_BULK) throw new SimError(`Select at most ${MAX_BULK} sessions at a time.`);
  for (const r of unique) await requireKind(userId, r.kind, r.id);
  return unique;
}

/** Archive or restore several sessions — all or nothing. */
export async function bulkSetArchived(userId: string, refs: SessionRef[], archived: boolean): Promise<number> {
  const list = await requireAll(userId, refs);
  const sim = list.filter((r) => r.kind !== "LEGACY").map((r) => r.id);
  const runs = list.filter((r) => r.kind === "LEGACY").map((r) => r.id);
  await prisma.$transaction(async (tx) => {
    if (archived) {
      await tx.simAccount.updateMany({ where: { userId, id: { in: sim }, archivedAt: null }, data: { archivedAt: new Date() } });
      await tx.backtestRun.updateMany({ where: { userId, id: { in: runs } }, data: { status: "ARCHIVED", archivedAt: new Date() } });
      return;
    }
    // Restore: clear the flag; older status-based archives get a status that fits the account's history.
    for (const a of await tx.simAccount.findMany({ where: { userId, id: { in: sim } } })) {
      const status = a.status === "ARCHIVED" ? (a.endedAt ? "COMPLETED" : a.currentMinute != null ? "ACTIVE" : "CREATED") : a.status;
      await tx.simAccount.update({ where: { id: a.id }, data: { archivedAt: null, status } });
    }
    await tx.backtestRun.updateMany({ where: { userId, id: { in: runs }, status: "ARCHIVED" }, data: { status: "COMPLETED", archivedAt: null } });
    await tx.backtestRun.updateMany({ where: { userId, id: { in: runs } }, data: { archivedAt: null } });
  });
  return list.length;
}

/**
 * Delete several sessions. Refused as a whole if any isn't the user's or
 * can't be deleted (Prop Firm). Lab accounts go in one transaction; legacy
 * runs then each in their own (their media files are removed after commit).
 */
export async function bulkDelete(userId: string, refs: SessionRef[]): Promise<number> {
  const list = await requireAll(userId, refs);
  const lab = list.filter((r) => r.kind === "LAB").map((r) => r.id);
  const propAccounts = await prisma.simAccount.findMany({ where: { userId, id: { in: list.filter((r) => r.kind === "PROP").map((r) => r.id) } } });
  const challengeIds = [...new Set(propAccounts.map((a) => a.challengeId).filter((c): c is string => c != null))];
  const loose = propAccounts.filter((a) => a.challengeId == null).map((a) => a.id);
  if (lab.length || propAccounts.length) {
    await prisma.$transaction(async (tx) => {
      const r = await tx.simAccount.deleteMany({ where: { userId, id: { in: [...lab, ...loose] } } });
      if (r.count !== lab.length + loose.length) throw new SimError("Some of these sessions changed meanwhile — nothing was deleted. Refresh and try again.");
      // A challenge's accounts (and their history) cascade with it.
      const c = await tx.simChallenge.deleteMany({ where: { userId, id: { in: challengeIds } } });
      if (c.count !== challengeIds.length) throw new SimError("Some of these sessions changed meanwhile — nothing was deleted. Refresh and try again.");
    });
  }
  for (const r of list.filter((x) => x.kind === "LEGACY")) await deleteBacktestRun(userId, r.id);
  return list.length;
}

/** Every account of the challenge a Prop Firm account belongs to (just itself if it has none). */
async function challengeAccountIds(userId: string, a: SimAccount): Promise<string[]> {
  if (!a.challengeId) return [a.id];
  return (await prisma.simAccount.findMany({ where: { userId, challengeId: a.challengeId }, select: { id: true } })).map((x) => x.id);
}

/**
 * Deletes a Prop Firm challenge with every stage account. One owner-scoped
 * statement: the database cascades accounts → orders, fills, positions,
 * ledger, events, breaches, payouts, drawings (observations are unlinked).
 */
async function deletePropChallenge(userId: string, a: SimAccount): Promise<void> {
  const r = a.challengeId
    ? await prisma.simChallenge.deleteMany({ where: { id: a.challengeId, userId } })
    : await prisma.simAccount.deleteMany({ where: { id: a.id, userId, product: "PROP_FIRM" } });
  if (r.count !== 1) throw new SimNotFoundError();
}

/**
 * Every simulated session of the user — Strategy Lab accounts and Prop Firm
 * challenges (with all their history) — in one transaction. Historical
 * datasets, strategies and studies are kept (observations are unlinked).
 */
export async function deleteAllSimulations(userId: string): Promise<void> {
  await prisma.$transaction(async (tx) => {
    await tx.simChallenge.deleteMany({ where: { userId } });
    await tx.simAccount.deleteMany({ where: { userId } });
  });
}

