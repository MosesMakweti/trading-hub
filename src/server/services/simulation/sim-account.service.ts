/**
 * Simulation accounts — creation, ownership, the row lock, clock start and
 * lifecycle status (docs/SIMULATION_PLATFORM.md).
 *
 * Every function takes `userId` first and scopes by it; an account that isn't
 * the caller's is indistinguishable from one that doesn't exist. Money and
 * clock changes run inside a transaction holding `lockAccount` (row lock), so
 * two tabs or a double submit apply one after the other.
 */
import { Prisma, type SimAccount } from "@prisma/client";
import type { Decimal } from "decimal.js";

import { prisma, type TransactionClient } from "@/server/db";
import { dec } from "@/domain/execution/precision";
import { normalizeSymbol } from "@/domain/native-replay/import-analysis";
import { MINUTES_PER_DAY } from "@/domain/native-replay/wall-clock";
import { dateKeyToUtcDate } from "@/lib/date";
import { labRules, parseRules, type SimRules } from "@/domain/simulation/rules";
import { captureStrategySnapshot } from "@/server/services/strategies.service";
import { accountFeeds, firstMinuteFrom, periodMinutes } from "./sim-market";

/** A refusal written for the trader (shown verbatim). */
export class SimError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SimError";
  }
}

export class SimNotFoundError extends Error {
  constructor() {
    super("Simulation account not found.");
    this.name = "SimNotFoundError";
  }
}

export async function requireSimAccount(userId: string, accountId: string, db: TransactionClient | typeof prisma = prisma): Promise<SimAccount> {
  const account = await db.simAccount.findFirst({ where: { id: accountId, userId } });
  if (!account) throw new SimNotFoundError();
  return account;
}

/** Locks the account row for the rest of the transaction and returns it fresh. */
/** Locks the user's account row for the transaction and returns it — one statement. */
export async function lockAccount(tx: TransactionClient, userId: string, accountId: string): Promise<SimAccount> {
  const rows = await tx.$queryRaw<SimAccount[]>`SELECT * FROM "SimAccount" WHERE "id" = ${accountId} AND "userId" = ${userId} FOR UPDATE`;
  if (rows.length === 0) throw new SimNotFoundError();
  return rows[0];
}

/** `lockAccount` plus the ledger balance at the account's sequence, in the same statement. */
export async function lockAccountWithBalance(tx: TransactionClient, userId: string, accountId: string): Promise<{ account: SimAccount; balance: Decimal }> {
  const rows = await tx.$queryRaw<(SimAccount & { __balance: Prisma.Decimal | null })[]>`
    SELECT a.*, l."balanceAfter" AS "__balance"
    FROM "SimAccount" a
    LEFT JOIN "SimLedgerEntry" l ON l."accountId" = a."id" AND l."sequence" = a."ledgerSequence"
    WHERE a."id" = ${accountId} AND a."userId" = ${userId}
    FOR UPDATE OF a
  `;
  if (rows.length === 0) throw new SimNotFoundError();
  const { __balance, ...account } = rows[0];
  if (__balance == null) throw new Error(`LEDGER_CORRUPT: account ${accountId} has no ledger entry ${account.ledgerSequence}`);
  return { account, balance: dec(__balance.toString()) };
}

export function accountRules(account: Pick<SimAccount, "rules">): SimRules {
  return parseRules(account.rules);
}

export interface CreateLabAccountInput {
  name: string;
  description?: string | null;
  strategyId?: string | null;
  experimentId?: string | null;
  /** asset symbol → dataset id */
  datasets: { assetSymbol: string; datasetId: string }[];
  periodStart: string;
  periodEnd: string;
  startingBalance: number;
  currency: string;
  costs?: Partial<SimRules["costs"]>;
  dailyResetHour?: number;
}

/** Checks a dataset can serve an asset over a period; returns covered days. */
async function checkPin(userId: string, assetSymbol: string, datasetId: string, period: { from: number; to: number }): Promise<number> {
  const ds = await prisma.historicalDataset.findFirst({ where: { id: datasetId, userId } });
  if (!ds) throw new SimError("That historical dataset wasn't found.");
  if (ds.status !== "READY" || ds.baseTimeframe !== "M1") throw new SimError(`${ds.symbol}: only a fully imported M1 dataset can be used.`);
  if (ds.symbol !== normalizeSymbol(assetSymbol)) throw new SimError(`The ${ds.symbol} dataset can't be used for ${assetSymbol}.`);
  const [{ days }] = await prisma.$queryRaw<{ days: number }[]>`
    SELECT count(DISTINCT "minute" / ${MINUTES_PER_DAY})::int AS days
    FROM "HistoricalBar" WHERE "datasetSeq" = ${ds.seq} AND "minute" BETWEEN ${period.from} AND ${period.to}
  `;
  if (days === 0) throw new SimError(`The ${ds.symbol} dataset has no bars inside this period.`);
  return days;
}

/** Shared creation path for every product: account + pins + initial ledger entry, in one transaction. */
export async function createSimAccount(
  userId: string,
  input: {
    product: SimAccount["product"];
    kind: SimAccount["kind"];
    name: string;
    description?: string | null;
    strategyId?: string | null;
    /** A strategy experiment under test: its working strategy is the strategy snapshotted. */
    experimentId?: string | null;
    datasets: { assetSymbol: string; datasetId: string }[];
    periodStart: string;
    periodEnd: string;
    startingBalance: number;
    currency: string;
    rules: SimRules;
    challengeId?: string | null;
    phaseIndex?: number | null;
  },
  db?: TransactionClient,
): Promise<SimAccount> {
  if (input.periodEnd < input.periodStart) throw new SimError("The end date must be on or after the start date.");
  const assets = [...new Set(input.datasets.map((d) => d.assetSymbol.trim().toUpperCase()))];
  if (assets.length === 0) throw new SimError("Add at least one instrument with historical data.");
  if (assets.length !== input.datasets.length) throw new SimError("Each instrument can be listed only once.");
  const periodStart = dateKeyToUtcDate(input.periodStart);
  const periodEnd = dateKeyToUtcDate(input.periodEnd);
  const period = periodMinutes({ periodStart, periodEnd });
  for (const d of input.datasets) await checkPin(userId, d.assetSymbol, d.datasetId, period);

  let strategy: Pick<Prisma.SimAccountUncheckedCreateInput, "strategyId" | "strategyNameSnapshot" | "strategyVersionSnapshot" | "strategySnapshot" | "experimentId"> = {};
  let strategyId = input.strategyId ?? null;
  if (input.experimentId) {
    const experiment = await prisma.strategyExperiment.findFirst({
      where: { id: input.experimentId, userId },
      select: { id: true, status: true, workingStrategyId: true },
    });
    if (!experiment) throw new SimError("That experiment wasn't found.");
    if (experiment.status !== "ACTIVE") throw new SimError("That experiment is closed — start a new one to keep testing.");
    if (strategyId && strategyId !== experiment.workingStrategyId) throw new SimError("Choose either a strategy or an experiment, not both.");
    strategyId = experiment.workingStrategyId;
    strategy.experimentId = experiment.id;
  }
  if (strategyId) {
    const captured = await captureStrategySnapshot(userId, strategyId);
    if (!captured) throw new SimError("That strategy no longer exists.");
    strategy = {
      ...strategy,
      strategyId,
      strategyNameSnapshot: captured.name,
      strategyVersionSnapshot: captured.version,
      strategySnapshot: captured.snapshot as unknown as Prisma.InputJsonValue,
    };
  }

  const create = async (tx: TransactionClient) => {
    const account = await tx.simAccount.create({
      data: {
        userId,
        product: input.product,
        kind: input.kind,
        name: input.name,
        description: input.description ?? null,
        currency: input.currency.toUpperCase(),
        startingBalance: input.startingBalance,
        rules: input.rules as unknown as Prisma.InputJsonValue,
        assets,
        periodStart,
        periodEnd,
        ...strategy,
        challengeId: input.challengeId ?? null,
        phaseIndex: input.phaseIndex ?? null,
        ledgerSequence: 1,
      },
    });
    await tx.simDatasetPin.createMany({
      data: input.datasets.map((d) => ({ userId, accountId: account.id, assetSymbol: d.assetSymbol.trim().toUpperCase(), datasetId: d.datasetId })),
    });
    await tx.simLedgerEntry.create({
      data: {
        userId,
        accountId: account.id,
        sequence: 1,
        type: "INITIAL_BALANCE",
        amount: input.startingBalance,
        balanceAfter: input.startingBalance,
        idempotencyKey: "initial-balance",
        note: "Starting balance",
      },
    });
    await tx.simEvent.create({ data: { userId, accountId: account.id, type: "ACCOUNT_CREATED", data: { startingBalance: input.startingBalance, currency: input.currency } } });
    return account;
  };
  return db ? create(db) : prisma.$transaction(create);
}

export async function createLabAccount(userId: string, input: CreateLabAccountInput): Promise<SimAccount> {
  return createSimAccount(userId, {
    product: "STRATEGY_LAB",
    kind: "LAB",
    name: input.name,
    description: input.description,
    strategyId: input.strategyId,
    experimentId: input.experimentId,
    datasets: input.datasets,
    periodStart: input.periodStart,
    periodEnd: input.periodEnd,
    startingBalance: input.startingBalance,
    currency: input.currency,
    rules: labRules({ costs: input.costs, dailyResetHour: input.dailyResetHour }),
  });
}

/**
 * Starts the account's continuous replay clock at the first bar of its
 * period. Idempotent. From here on its datasets and rules are frozen (DB).
 */
export async function startSimClock(userId: string, accountId: string): Promise<SimAccount> {
  return prisma.$transaction(async (tx) => {
    const account = await lockAccount(tx, userId, accountId);
    if (account.currentMinute != null) return account;
    if (account.status !== "CREATED") throw new SimError("This account can no longer be started.");
    const feeds = await accountFeeds(tx, account.id);
    const period = periodMinutes(account);
    const first = await firstMinuteFrom(tx, feeds, period.from, period.to);
    if (first == null) throw new SimError("None of this account's datasets has bars inside its period.");
    const started = await tx.simAccount.update({
      where: { id: account.id },
      data: { currentMinute: first, status: "ACTIVE", startedAt: new Date(), clockVersion: { increment: 1 } },
    });
    await tx.simEvent.create({ data: { userId, accountId: account.id, type: "CLOCK_STARTED", minute: first } });
    return started;
  });
}

/** Trader-initiated lifecycle changes for Strategy Lab accounts. */
export async function setLabAccountStatus(userId: string, accountId: string, status: "ACTIVE" | "COMPLETED" | "ARCHIVED"): Promise<SimAccount> {
  return prisma.$transaction(async (tx) => {
    const account = await lockAccount(tx, userId, accountId);
    if (account.product !== "STRATEGY_LAB") throw new SimError("Prop firm account status follows its rules and can't be set by hand.");
    if (status === "ACTIVE" && account.currentMinute == null) throw new SimError("Start the replay to activate this account.");
    const updated = await tx.simAccount.update({
      where: { id: account.id },
      data: {
        status,
        archivedAt: status === "ARCHIVED" ? (account.archivedAt ?? new Date()) : null,
        endedAt: status === "COMPLETED" ? new Date() : status === "ACTIVE" ? null : account.endedAt,
      },
    });
    await tx.simEvent.create({ data: { userId, accountId: account.id, type: `STATUS_${status}`, minute: account.currentMinute } });
    return updated;
  });
}

/** Permanently deletes an account and its whole history (cascade). */
export async function deleteSimAccount(userId: string, accountId: string): Promise<void> {
  const account = await requireSimAccount(userId, accountId);
  // A Prop Firm account is a stage of a challenge: the challenge goes as a whole.
  if (account.product === "PROP_FIRM" && account.challengeId) {
    await prisma.simChallenge.deleteMany({ where: { id: account.challengeId, userId } });
    return;
  }
  await prisma.simAccount.delete({ where: { id: account.id } });
}

export async function listSimAccounts(userId: string, filter: { product?: SimAccount["product"] } = {}) {
  return prisma.simAccount.findMany({
    where: { userId, ...(filter.product ? { product: filter.product } : {}) },
    orderBy: [{ updatedAt: "desc" }],
  });
}

/** The account must be tradable right now. */
export function assertTradable(account: SimAccount): void {
  if (account.currentMinute == null) throw new SimError("Start the replay before trading.");
  if (account.status !== "ACTIVE") {
    throw new SimError(
      account.status === "BREACHED"
        ? "This account breached a rule — trading is closed."
        : `This account is ${account.status.toLowerCase()} — trading is closed.`,
    );
  }
}

