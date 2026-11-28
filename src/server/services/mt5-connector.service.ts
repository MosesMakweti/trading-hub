import { Prisma } from "@prisma/client";

import { prisma, type TransactionClient } from "@/server/db";
import {
  Mt5ConnectorError,
  PAIRING_CODE_TTL_MS,
  generateMt5DeviceToken,
  generatePairingCode,
  hashClientIp,
  hashPairingCode,
} from "@/server/mt5-connector-auth";
import { defaultConvention, describeConvention, parseConvention, roundOffsetToQuarterHour, type ServerTimeConvention } from "@/domain/mt5-account/server-time";
import { canonicalDecimal, isDecimalString, stopField } from "@/domain/mt5-account/deal-classification";
import { MT5_MAX_DEALS_PER_BATCH, MT5_MAX_ORDERS_PER_BATCH, type Mt5PairRequest } from "@/lib/validation/mt5-connector";

/**
 * MT5 Connector (Stage 1) — connection lifecycle: pairing, pause/resume,
 * revocation, deletion, conflict detection against the Prop Firm statement
 * importer, and the read-only Broker History queries.
 *
 * Stage 1 boundaries: nothing in this module (or mt5-sync.service.ts) posts
 * to AccountLedgerEntry, changes how any account balance is computed,
 * creates or links a journal Trade, or touches PerformanceRiskSnapshot /
 * PositionFill / Trade.actualRR. Broker history is account-side only.
 */

export const MT5_HEARTBEAT_SECONDS = 60;
export const MT5_STALE_AFTER_MS = 5 * 60 * 1000;
export const PAIRING_RATE_LIMIT = { maxFailures: 10, windowMs: 15 * 60 * 1000 };

export function connectorConfig() {
  return {
    heartbeatSeconds: MT5_HEARTBEAT_SECONDS,
    maxDealsPerBatch: MT5_MAX_DEALS_PER_BATCH,
    maxOrdersPerBatch: MT5_MAX_ORDERS_PER_BATCH,
  };
}

// ── Conflict with the Prop Firm statement (CSV/HTML) importer ─────────────

export interface StatementImportConflict {
  confirmedBatches: number;
  latestFileName: string | null;
}

/** Confirmed (not rolled back) statement imports on the Prop Firm account
 *  paired with this TradingAccount — the same history would otherwise reach
 *  the account twice. */
export async function findStatementImportConflict(
  tradingAccountId: string,
  db: TransactionClient | typeof prisma = prisma,
): Promise<StatementImportConflict | null> {
  const propFirmAccount = await db.propFirmAccount.findFirst({ where: { tradingAccountId }, select: { id: true } });
  if (!propFirmAccount) return null;
  const batches = await db.propFirmImportBatch.findMany({
    where: { accountId: propFirmAccount.id, status: "CONFIRMED" },
    orderBy: { createdAt: "desc" },
    select: { fileName: true },
  });
  if (batches.length === 0) return null;
  return { confirmedBatches: batches.length, latestFileName: batches[0]!.fileName };
}

function statementConflictError(conflict: StatementImportConflict): Mt5ConnectorError {
  return new Mt5ConnectorError(
    "STATEMENT_IMPORT_CONFLICT",
    409,
    `This account already has ${conflict.confirmedBatches} imported broker statement${conflict.confirmedBatches === 1 ? "" : "s"}` +
      `${conflict.latestFileName ? ` (latest: ${conflict.latestFileName})` : ""}. ` +
      "Connecting MT5 would import the same trading history a second time. Roll back the statement import(s) on the account's Import page first, " +
      "or connect MT5 to a different account. Nothing was changed.",
  );
}

/**
 * Called by the Prop Firm statement importer (preview + confirm): refuses a
 * statement import while the account is connected to MT5, or still holds
 * MT5 broker history from an earlier connection. Never deletes anything.
 */
export async function assertStatementImportAllowed(userId: string, propFirmAccountId: string): Promise<void> {
  const account = await prisma.propFirmAccount.findFirst({ where: { id: propFirmAccountId, userId }, select: { tradingAccountId: true } });
  if (!account?.tradingAccountId) return;
  const connection = await prisma.mt5Connection.findUnique({
    where: { tradingAccountId: account.tradingAccountId },
    select: { status: true, login: true, server: true, _count: { select: { deals: true } } },
  });
  if (!connection) return;
  const live = connection.status !== "REVOKED";
  if (!live && connection._count.deals === 0) return;
  const who = connection.login ? `MT5 account ${connection.login}${connection.server ? ` @ ${connection.server}` : ""}` : "an MT5 terminal";
  throw new Error(
    live
      ? `This account is connected to ${who} through the Traditorium MT5 Connector, which already syncs its trading history. ` +
          "Importing a broker statement as well would record the same trades twice, so the import was blocked. Nothing was changed. " +
          "To use statement imports instead, disconnect MT5 and delete its broker history in Settings → Integrations."
      : `This account still holds broker history synced from ${who}. Importing a statement as well would record the same trades twice, ` +
          "so the import was blocked. Nothing was changed. Delete the MT5 broker history in Settings → Integrations first if you want to switch to statement imports.",
  );
}

// ── Accounts & connection summaries (web) ──────────────────────────────────

export interface Mt5ConnectionSummaryDTO {
  id: string;
  status: "PENDING_PAIRING" | "ACTIVE" | "PAUSED" | "REVOKED";
  login: string | null;
  server: string | null;
  brokerCompany: string | null;
  accountName: string | null;
  accountCurrency: string | null;
  marginMode: string | null;
  tradeMode: string | null;
  eaVersion: string | null;
  pairingExpiresAt: string | null;
  pairedAt: string | null;
  lastHeartbeatAt: string | null;
  lastSyncedAt: string | null;
  backfillStartedAt: string | null;
  backfillCompletedAt: string | null;
  historyFrom: string | null; // raw server time, ISO-formatted (not UTC)
  historyTo: string | null;
  dealCount: number;
  orderCount: number;
  positionCount: number;
  openPositionCount: number;
  revokedAt: string | null;
  revokedReason: string | null;
  stale: boolean;
  timeConvention: ServerTimeConvention | null;
  timeConventionLabel: string;
  observedOffsetMinutes: number | null;
  offsetMismatch: boolean;
}

export interface Mt5AccountOptionDTO {
  tradingAccountId: string;
  name: string;
  kind: "PROP_FIRM" | "PERSONAL_BROKERAGE";
  statementImportConflict: StatementImportConflict | null;
  connection: Mt5ConnectionSummaryDTO | null;
}

const iso = (d: Date | null | undefined) => (d ? d.toISOString() : null);
const serverIso = (msc: bigint | null | undefined) => (msc == null ? null : new Date(Number(msc)).toISOString().replace("Z", ""));

const summarySelect = {
  id: true,
  status: true,
  login: true,
  server: true,
  brokerCompany: true,
  accountName: true,
  accountCurrency: true,
  marginMode: true,
  tradeMode: true,
  eaVersion: true,
  pairingExpiresAt: true,
  pairedAt: true,
  lastHeartbeatAt: true,
  lastSyncedAt: true,
  backfillStartedAt: true,
  backfillCompletedAt: true,
  historyFromMsc: true,
  historyToMsc: true,
  revokedAt: true,
  revokedReason: true,
  timeConventionJson: true,
  observedOffsetMinutes: true,
  _count: { select: { deals: true, orders: true, positions: true } },
} satisfies Prisma.Mt5ConnectionSelect;

type SummaryRow = Prisma.Mt5ConnectionGetPayload<{ select: typeof summarySelect }>;

function toSummary(row: SummaryRow, openPositionCount: number, now = new Date()): Mt5ConnectionSummaryDTO {
  const convention = parseConvention(row.timeConventionJson);
  return {
    id: row.id,
    status: row.status,
    login: row.login,
    server: row.server,
    brokerCompany: row.brokerCompany,
    accountName: row.accountName,
    accountCurrency: row.accountCurrency,
    marginMode: row.marginMode,
    tradeMode: row.tradeMode,
    eaVersion: row.eaVersion,
    pairingExpiresAt: row.status === "PENDING_PAIRING" ? iso(row.pairingExpiresAt) : null,
    pairedAt: iso(row.pairedAt),
    lastHeartbeatAt: iso(row.lastHeartbeatAt),
    lastSyncedAt: iso(row.lastSyncedAt),
    backfillStartedAt: iso(row.backfillStartedAt),
    backfillCompletedAt: iso(row.backfillCompletedAt),
    historyFrom: serverIso(row.historyFromMsc),
    historyTo: serverIso(row.historyToMsc),
    dealCount: row._count.deals,
    orderCount: row._count.orders,
    positionCount: row._count.positions,
    openPositionCount,
    revokedAt: iso(row.revokedAt),
    revokedReason: row.revokedReason,
    stale: row.status === "ACTIVE" && (!row.lastHeartbeatAt || now.getTime() - row.lastHeartbeatAt.getTime() > MT5_STALE_AFTER_MS),
    timeConvention: convention,
    timeConventionLabel: describeConvention(convention),
    observedOffsetMinutes: row.observedOffsetMinutes,
    offsetMismatch: convention?.kind === "FIXED_OFFSET" && row.observedOffsetMinutes != null && row.observedOffsetMinutes !== convention.offsetMinutes,
  };
}

async function openPositionCount(connectionId: string): Promise<number> {
  return prisma.mt5Position.count({ where: { connectionId, status: "OPEN" } });
}

/** Every account an MT5 terminal can be connected to (prop-firm and
 *  brokerage; never the virtual Performance Account), with its connection. */
export async function listMt5AccountOptions(userId: string): Promise<Mt5AccountOptionDTO[]> {
  const accounts = await prisma.tradingAccount.findMany({
    where: { userId, kind: { in: ["PROP_FIRM", "PERSONAL_BROKERAGE"] } },
    orderBy: { createdAt: "asc" },
    select: {
      id: true,
      name: true,
      kind: true,
      propFirmAccount: { select: { displayName: true, deletedAt: true } },
      mt5Connection: { select: summarySelect },
    },
  });
  const result: Mt5AccountOptionDTO[] = [];
  for (const a of accounts) {
    if (a.propFirmAccount?.deletedAt) continue;
    result.push({
      tradingAccountId: a.id,
      name: a.propFirmAccount?.displayName ?? a.name,
      kind: a.kind as "PROP_FIRM" | "PERSONAL_BROKERAGE",
      statementImportConflict: await findStatementImportConflict(a.id),
      connection: a.mt5Connection ? toSummary(a.mt5Connection, await openPositionCount(a.mt5Connection.id)) : null,
    });
  }
  return result;
}

async function ownedConnection(userId: string, connectionId: string) {
  const connection = await prisma.mt5Connection.findFirst({ where: { id: connectionId, userId } });
  if (!connection) throw new Mt5ConnectorError("NOT_FOUND", 404, "MT5 connection not found.");
  return connection;
}

// ── Pairing ────────────────────────────────────────────────────────────────

/**
 * Issues a fresh single-use pairing code for an account (creating its
 * connection on first use). Allowed when the account has no connection, a
 * pending one (the old code is replaced), or a revoked one (re-connect: the
 * new terminal must present the SAME MT5 login + server as before).
 */
export async function issuePairingCode(userId: string, tradingAccountId: string, now = new Date()) {
  const account = await prisma.tradingAccount.findFirst({ where: { id: tradingAccountId, userId }, select: { id: true, kind: true } });
  if (!account) throw new Mt5ConnectorError("NOT_FOUND", 404, "Account not found.");
  if (account.kind === "PERFORMANCE") {
    throw new Mt5ConnectorError("NOT_CONNECTABLE", 422, "The Performance Account is a virtual benchmark and can't be connected to MT5.");
  }
  const conflict = await findStatementImportConflict(tradingAccountId);
  if (conflict) throw statementConflictError(conflict);

  const existing = await prisma.mt5Connection.findUnique({ where: { tradingAccountId }, select: { id: true, status: true } });
  if (existing && (existing.status === "ACTIVE" || existing.status === "PAUSED")) {
    throw new Mt5ConnectorError("ALREADY_CONNECTED", 409, "This account is already connected. Disconnect it first to pair a different terminal.");
  }

  const { code, codeHash } = generatePairingCode();
  const expiresAt = new Date(now.getTime() + PAIRING_CODE_TTL_MS);
  const connection = existing
    ? await prisma.mt5Connection.update({
        where: { id: existing.id },
        data: { status: "PENDING_PAIRING", pairingCodeHash: codeHash, pairingExpiresAt: expiresAt, tokenHash: null, tokenPrefix: null },
        select: { id: true },
      })
    : await prisma.mt5Connection.create({
        data: { userId, tradingAccountId, status: "PENDING_PAIRING", pairingCodeHash: codeHash, pairingExpiresAt: expiresAt },
        select: { id: true },
      });
  return { connectionId: connection.id, code, expiresAt };
}

async function recordPairingAttempt(ipHash: string, success: boolean, now: Date) {
  await prisma.mt5PairingAttempt.create({ data: { ipHash, success, createdAt: now } });
}

async function enforcePairingRateLimit(ipHash: string, now: Date) {
  // Lazy pruning — there is no scheduler in this deployment.
  await prisma.mt5PairingAttempt.deleteMany({ where: { createdAt: { lt: new Date(now.getTime() - 24 * 3600 * 1000) } } });
  const failures = await prisma.mt5PairingAttempt.count({
    where: { ipHash, success: false, createdAt: { gte: new Date(now.getTime() - PAIRING_RATE_LIMIT.windowMs) } },
  });
  if (failures >= PAIRING_RATE_LIMIT.maxFailures) {
    throw new Mt5ConnectorError("RATE_LIMITED", 429, "Too many pairing attempts. Wait 15 minutes and try again.");
  }
}

const INVALID_CODE = () =>
  new Mt5ConnectorError("PAIRING_CODE_INVALID", 410, "This pairing code is invalid, expired or already used. Generate a new one in Settings → Integrations.");

export interface PairResult {
  connectionId: string;
  deviceToken: string;
  tokenPrefix: string;
  account: { login: string; server: string };
  timeConvention: ServerTimeConvention;
  config: ReturnType<typeof connectorConfig>;
}

/**
 * Exchanges a pairing code for a device token. The code is consumed only on
 * success (a conditional update on the still-pending code makes concurrent
 * use of the same code yield exactly one token). Never asks for, accepts or
 * stores an MT5 password.
 */
export async function pairMt5Terminal(input: Mt5PairRequest, clientIp: string, now = new Date()): Promise<PairResult> {
  const ipHash = hashClientIp(clientIp);
  await enforcePairingRateLimit(ipHash, now);

  const codeHash = hashPairingCode(input.pairingCode);
  const connection = await prisma.mt5Connection.findUnique({
    where: { pairingCodeHash: codeHash },
    select: {
      id: true,
      userId: true,
      tradingAccountId: true,
      status: true,
      pairingExpiresAt: true,
      login: true,
      server: true,
      timeConventionJson: true,
      tradingAccount: { select: { deletedAt: true } },
    },
  });
  if (
    !connection ||
    connection.status !== "PENDING_PAIRING" ||
    !connection.pairingExpiresAt ||
    connection.pairingExpiresAt.getTime() <= now.getTime() ||
    connection.tradingAccount.deletedAt != null
  ) {
    await recordPairingAttempt(ipHash, false, now);
    throw INVALID_CODE();
  }

  const t = input.terminal;
  const server = t.server.trim();
  if (connection.login && (connection.login !== t.login || connection.server !== server)) {
    throw new Mt5ConnectorError(
      "IDENTITY_MISMATCH",
      409,
      `This Traditorium account was previously connected to MT5 account ${connection.login} @ ${connection.server}. ` +
        "Attach the Expert Advisor to that MT5 account, or delete this connection's broker history in Settings → Integrations to connect a different one.",
    );
  }
  const conflict = await findStatementImportConflict(connection.tradingAccountId);
  if (conflict) throw statementConflictError(conflict);
  const elsewhere = await prisma.mt5Connection.findFirst({
    where: { userId: connection.userId, login: t.login, server, id: { not: connection.id } },
    select: { id: true },
  });
  if (elsewhere) {
    throw new Mt5ConnectorError("ALREADY_CONNECTED", 409, `MT5 account ${t.login} @ ${server} is already connected to another of your Traditorium accounts.`);
  }

  const offsetMinutes = roundOffsetToQuarterHour(t.gmtOffsetSeconds);
  const convention = parseConvention(connection.timeConventionJson) ?? defaultConvention(offsetMinutes);
  const token = generateMt5DeviceToken();

  let updated: number;
  try {
    const res = await prisma.mt5Connection.updateMany({
      where: { id: connection.id, pairingCodeHash: codeHash, status: "PENDING_PAIRING" },
      data: {
        status: "ACTIVE",
        tokenHash: token.tokenHash,
        tokenPrefix: token.tokenPrefix,
        pairingCodeHash: null,
        pairingExpiresAt: null,
        pairedAt: now,
        login: t.login,
        server,
        brokerCompany: t.company ?? null,
        accountName: t.name ?? null,
        accountCurrency: t.currency,
        currencyDigits: t.currencyDigits ?? null,
        leverage: t.leverage ?? null,
        marginMode: t.marginMode,
        tradeMode: t.tradeMode,
        terminalBuild: t.build ?? null,
        eaVersion: t.eaVersion,
        observedOffsetMinutes: offsetMinutes,
        timeConventionJson: convention as unknown as Prisma.InputJsonValue,
        lastHeartbeatAt: now,
        // A (re-)pair always re-sends the full history; duplicates are skipped.
        backfillStartedAt: now,
        backfillCompletedAt: null,
        pausedAt: null,
        revokedAt: null,
        revokedReason: null,
      },
    });
    updated = res.count;
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
      throw new Mt5ConnectorError("ALREADY_CONNECTED", 409, `MT5 account ${t.login} @ ${server} is already connected to another of your Traditorium accounts.`);
    }
    throw e;
  }
  if (updated !== 1) {
    await recordPairingAttempt(ipHash, false, now);
    throw INVALID_CODE(); // lost a race with a concurrent use of the same code
  }
  await recordPairingAttempt(ipHash, true, now);
  return {
    connectionId: connection.id,
    deviceToken: token.rawToken,
    tokenPrefix: token.tokenPrefix,
    account: { login: t.login, server },
    timeConvention: convention,
    config: connectorConfig(),
  };
}

// ── Lifecycle ──────────────────────────────────────────────────────────────

export async function pauseMt5Connection(userId: string, connectionId: string, now = new Date()) {
  const connection = await ownedConnection(userId, connectionId);
  if (connection.status !== "ACTIVE") throw new Mt5ConnectorError("INVALID_STATE", 409, "Only an active connection can be paused.");
  await prisma.mt5Connection.update({ where: { id: connectionId }, data: { status: "PAUSED", pausedAt: now } });
}

export async function resumeMt5Connection(userId: string, connectionId: string) {
  const connection = await ownedConnection(userId, connectionId);
  if (connection.status !== "PAUSED") throw new Mt5ConnectorError("INVALID_STATE", 409, "Only a paused connection can be resumed.");
  await prisma.mt5Connection.update({ where: { id: connectionId }, data: { status: "ACTIVE", pausedAt: null } });
}

/** Destroys the device token (and any pending pairing code). Broker history
 *  is kept — deleting it is a separate, explicit action. Idempotent. */
export async function revokeMt5Connection(userId: string, connectionId: string, reason = "Disconnected by trader", now = new Date()) {
  await ownedConnection(userId, connectionId);
  await revokeWhere(prisma, { id: connectionId, userId }, reason, now);
}

async function revokeWhere(db: TransactionClient | typeof prisma, where: Prisma.Mt5ConnectionWhereInput, reason: string, now: Date) {
  await db.mt5Connection.updateMany({
    where: { ...where, status: { not: "REVOKED" } },
    data: { status: "REVOKED", tokenHash: null, pairingCodeHash: null, pairingExpiresAt: null, revokedAt: now, revokedReason: reason },
  });
}

/** Account soft-delete hook (accounts.service / prop-firms.service): the
 *  account is gone from the app, so its connector must stop working. The
 *  broker history stays with the (soft-deleted) account; a hard delete of
 *  the account cascades it away. */
export async function revokeMt5ConnectionForTradingAccount(db: TransactionClient | typeof prisma, tradingAccountId: string, now = new Date()) {
  await revokeWhere(db, { tradingAccountId }, "Account deleted", now);
}

/** Permanently deletes a DISCONNECTED connection and all of its broker
 *  history. Explicit and irreversible — never called implicitly. */
export async function deleteMt5BrokerHistory(userId: string, connectionId: string) {
  const connection = await ownedConnection(userId, connectionId);
  if (connection.status === "ACTIVE" || connection.status === "PAUSED") {
    throw new Mt5ConnectorError("INVALID_STATE", 409, "Disconnect the MT5 terminal before deleting its broker history.");
  }
  await prisma.mt5Connection.delete({ where: { id: connectionId } });
}

// ── Broker History (read-only) ─────────────────────────────────────────────

export interface BrokerDealDTO {
  ticket: string;
  orderTicket: string | null;
  positionId: string | null;
  serverTime: string;
  occurredAt: string;
  type: string;
  category: string;
  side: string | null;
  entry: string | null;
  reason: string | null;
  symbol: string | null;
  volume: string | null;
  price: string | null;
  profit: string;
  commission: string;
  swap: string;
  fee: string;
  stopLoss: string | null;
  takeProfit: string | null;
  comment: string | null;
}

export interface BrokerPositionDTO {
  positionId: string;
  symbol: string;
  direction: "LONG" | "SHORT";
  status: "OPEN" | "CLOSED";
  openedAt: string | null;
  closedAt: string | null;
  volumeIn: string;
  volumeOut: string;
  openVolume: string;
  avgEntryPrice: string | null;
  avgExitPrice: string | null;
  profit: string;
  commission: string;
  swap: string;
  fee: string;
  netProfit: string;
  dealCount: number;
  reversalCount: number;
  initialStopLoss: string | null;
  initialTakeProfit: string | null;
  initialStopSource: string;
  flags: string[];
  segments: unknown;
  live: { open: boolean; stopLoss: string | null; takeProfit: string | null; currentPrice: string | null; profit: string | null; observedAt: string | null };
  deals: BrokerDealDTO[];
}

export interface BrokerOpenPositionDTO {
  positionId: string;
  symbol: string;
  type: string;
  volume: string;
  priceOpen: string;
  priceCurrent: string | null;
  sl: string | null;
  tp: string | null;
  swap: string | null;
  profit: string | null;
}

export interface BrokerHistoryDTO {
  accountName: string;
  connection: Mt5ConnectionSummaryDTO;
  snapshot: {
    capturedAt: string;
    balance: string;
    equity: string;
    margin: string;
    freeMargin: string;
    credit: string;
    profit: string;
    openPositions: BrokerOpenPositionDTO[];
  } | null;
  positions: BrokerPositionDTO[];
  page: number;
  pageCount: number;
  balanceOperations: BrokerDealDTO[];
  recentRejections: { batchAt: string; kind: string; items: unknown }[];
}

const dec = (v: Prisma.Decimal | null | undefined) => (v == null ? null : v.toString());

function dealDTO(d: Prisma.Mt5DealGetPayload<Record<string, never>>): BrokerDealDTO {
  return {
    ticket: d.ticket,
    orderTicket: d.orderTicket,
    positionId: d.positionId,
    serverTime: d.serverTime.toISOString().replace("Z", ""),
    occurredAt: d.occurredAt.toISOString(),
    type: d.type,
    category: d.category,
    side: d.side,
    entry: d.entry,
    reason: d.reason,
    symbol: d.symbol,
    volume: dec(d.volume),
    price: dec(d.price),
    profit: d.profit.toString(),
    commission: d.commission.toString(),
    swap: d.swap.toString(),
    fee: d.fee.toString(),
    stopLoss: dec(d.stopLoss),
    takeProfit: dec(d.takeProfit),
    comment: d.comment,
  };
}

export const BROKER_HISTORY_PAGE_SIZE = 50;

/** Snapshot open positions are stored exactly as the terminal sent them;
 *  for display, decimals are canonicalized and a 0 SL/TP means "none". */
function toOpenPositionDTO(raw: unknown): BrokerOpenPositionDTO {
  const r = (raw ?? {}) as Record<string, unknown>;
  const str = (v: unknown) => (typeof v === "string" ? v : null);
  const num = (v: unknown) => {
    const x = str(v);
    return x != null && isDecimalString(x) ? canonicalDecimal(x) : x;
  };
  const level = (v: unknown) => {
    const x = str(v);
    return x != null && isDecimalString(x) ? stopField(x).level : null;
  };
  return {
    positionId: str(r.positionId) ?? "",
    symbol: str(r.symbol) ?? "",
    type: str(r.type) ?? "",
    volume: num(r.volume) ?? "",
    priceOpen: num(r.priceOpen) ?? "",
    priceCurrent: num(r.priceCurrent),
    sl: level(r.sl),
    tp: level(r.tp),
    swap: num(r.swap),
    profit: num(r.profit),
  };
}

export async function getBrokerHistory(userId: string, tradingAccountId: string, page = 1): Promise<BrokerHistoryDTO | null> {
  const account = await prisma.tradingAccount.findFirst({
    where: { id: tradingAccountId, userId },
    select: { name: true, propFirmAccount: { select: { displayName: true } }, mt5Connection: { select: summarySelect } },
  });
  if (!account?.mt5Connection) return null;
  const connection = account.mt5Connection;

  const [snapshot, openCount, rejections] = await Promise.all([
    prisma.mt5AccountSnapshot.findFirst({ where: { connectionId: connection.id }, orderBy: { capturedAt: "desc" } }),
    openPositionCount(connection.id),
    prisma.mt5SyncBatch.findMany({
      where: { connectionId: connection.id },
      orderBy: { createdAt: "desc" },
      take: 20,
      select: { createdAt: true, kind: true, responseJson: true },
    }),
  ]);

  const total = connection._count.positions;
  const pageCount = Math.max(1, Math.ceil(total / BROKER_HISTORY_PAGE_SIZE));
  const safePage = Math.min(Math.max(1, Math.floor(page) || 1), pageCount);
  const positions = await prisma.mt5Position.findMany({
    where: { connectionId: connection.id },
    orderBy: [{ status: "asc" }, { closedMsc: { sort: "desc", nulls: "first" } }, { openedMsc: "desc" }],
    skip: (safePage - 1) * BROKER_HISTORY_PAGE_SIZE,
    take: BROKER_HISTORY_PAGE_SIZE,
  });
  const deals = positions.length
    ? await prisma.mt5Deal.findMany({
        where: { connectionId: connection.id, positionId: { in: positions.map((p) => p.positionId) } },
        orderBy: [{ timeMsc: "asc" }, { ticket: "asc" }],
      })
    : [];
  const dealsByPosition = new Map<string, BrokerDealDTO[]>();
  for (const d of deals) {
    const list = dealsByPosition.get(d.positionId!) ?? [];
    list.push(dealDTO(d));
    dealsByPosition.set(d.positionId!, list);
  }
  const balanceDeals = await prisma.mt5Deal.findMany({
    where: { connectionId: connection.id, category: { notIn: ["TRADE", "TRADE_CANCELED"] } },
    orderBy: { timeMsc: "desc" },
    take: 200,
  });

  return {
    accountName: account.propFirmAccount?.displayName ?? account.name,
    connection: toSummary(connection, openCount),
    snapshot: snapshot
      ? {
          capturedAt: snapshot.capturedAt.toISOString(),
          balance: snapshot.balance.toString(),
          equity: snapshot.equity.toString(),
          margin: snapshot.margin.toString(),
          freeMargin: snapshot.freeMargin.toString(),
          credit: snapshot.credit.toString(),
          profit: snapshot.profit.toString(),
          openPositions: (Array.isArray(snapshot.openPositions) ? snapshot.openPositions : []).map(toOpenPositionDTO),
        }
      : null,
    positions: positions.map((p) => ({
      positionId: p.positionId,
      symbol: p.symbol,
      direction: p.direction,
      status: p.status,
      openedAt: iso(p.openedAt),
      closedAt: iso(p.closedAt),
      volumeIn: p.volumeIn.toString(),
      volumeOut: p.volumeOut.toString(),
      openVolume: p.openVolume.toString(),
      avgEntryPrice: dec(p.avgEntryPrice),
      avgExitPrice: dec(p.avgExitPrice),
      profit: p.profit.toString(),
      commission: p.commission.toString(),
      swap: p.swap.toString(),
      fee: p.fee.toString(),
      netProfit: p.netProfit.toString(),
      dealCount: p.dealCount,
      reversalCount: p.reversalCount,
      initialStopLoss: dec(p.initialStopLoss),
      initialTakeProfit: dec(p.initialTakeProfit),
      initialStopSource: p.initialStopSource,
      flags: p.flags,
      segments: p.segments,
      live: {
        open: p.liveOpen,
        stopLoss: dec(p.liveStopLoss),
        takeProfit: dec(p.liveTakeProfit),
        currentPrice: dec(p.liveCurrentPrice),
        profit: dec(p.liveProfit),
        observedAt: iso(p.liveObservedAt),
      },
      deals: dealsByPosition.get(p.positionId) ?? [],
    })),
    page: safePage,
    pageCount,
    balanceOperations: balanceDeals.map(dealDTO),
    recentRejections: rejections
      .map((b) => ({ batchAt: b.createdAt.toISOString(), kind: b.kind, items: (b.responseJson as { rejected?: unknown[] } | null)?.rejected ?? [] }))
      .filter((r) => Array.isArray(r.items) && r.items.length > 0),
  };
}
