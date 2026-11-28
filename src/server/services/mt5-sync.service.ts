import { Prisma } from "@prisma/client";

import { prisma, type TransactionClient } from "@/server/db";
import { Mt5ConnectorError, type AuthenticatedMt5Connection } from "@/server/mt5-connector-auth";
import { currentWorkspaceScope } from "@/server/workspace/scope";
import { connectorConfig } from "@/server/services/mt5-connector.service";
import {
  normalizeDeal,
  normalizeOrder,
  payloadHash,
  stopField,
  type NormalizedDeal,
  type NormalizedOrder,
} from "@/domain/mt5-account/deal-classification";
import { derivePosition, MT5_POSITION_DERIVATION_VERSION, type DerivationDeal, type DerivationOrder } from "@/domain/mt5-account/position-derivation";
import { parseConvention, roundOffsetToQuarterHour, serverTimeToUtc, serverWallClock, type ServerTimeConvention } from "@/domain/mt5-account/server-time";
import {
  mt5DealWireSchema,
  mt5OrderWireSchema,
  mt5TimeConventionInputSchema,
  type Mt5EventsRequest,
  type Mt5HeartbeatRequest,
  type Mt5HistoryRequest,
  type Mt5SymbolsRequest,
} from "@/lib/validation/mt5-connector";

/**
 * MT5 Connector (Stage 1) — ingestion.
 *
 * Every write for a connection runs inside ONE transaction holding that
 * connection's advisory lock, so concurrent requests from the same terminal
 * serialize, and a failure leaves nothing half-written.
 *
 * Idempotency: (connectionId, Idempotency-Key) → Mt5SyncBatch. An identical
 * retry gets the stored response back; the same key with a different body
 * is refused (409). Independently of keys, every deal/order is deduplicated
 * by ticket: the FIRST stored copy is kept forever (raw broker record), a
 * re-sent identical copy counts as a duplicate, and a re-sent DIFFERENT copy
 * is reported as a conflict — never overwritten.
 *
 * Positions are re-derived only for the position ids a batch touched, from
 * ALL stored deals of that position, so out-of-order batches converge to the
 * same result as in-order ones.
 *
 * Stage 1 boundaries: no AccountLedgerEntry, no balance change, no journal
 * Trade, no PerformanceRiskSnapshot / PositionFill / Trade.actualRR writes.
 */

const SNAPSHOT_MIN_INTERVAL_MS = 60_000;
const TX_OPTIONS = { timeout: 60_000, maxWait: 15_000 } as const;

/** Broker history is LIVE data only. The routes enter runLive, but the
 *  services refuse independently so no caller can ingest from a Backtest
 *  (or unscoped) context. */
export function assertLiveIngestScope(): void {
  const scope = currentWorkspaceScope();
  if (scope.environment !== "LIVE") {
    throw new Mt5ConnectorError("SCOPE_REFUSED", 403, `MT5 broker history can only be ingested in the LIVE workspace (current: ${scope.environment}).`);
  }
}

async function lockConnection(tx: TransactionClient, connectionId: string): Promise<void> {
  const key = `mt5-conn:${connectionId}`;
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${key}, 0))`;
}

async function loadLockedConnection(tx: TransactionClient, connectionId: string, allowPaused = false) {
  await lockConnection(tx, connectionId);
  const c = await tx.mt5Connection.findUnique({
    where: { id: connectionId },
    select: {
      id: true,
      status: true,
      timeConventionJson: true,
      backfillCompletedAt: true,
      historyFromMsc: true,
      historyToMsc: true,
      lastDealTimeMsc: true,
      tradingAccount: { select: { deletedAt: true } },
    },
  });
  // Re-checked under the lock: the trader may have revoked/paused since auth.
  if (!c || c.status === "REVOKED" || c.status === "PENDING_PAIRING" || c.tradingAccount.deletedAt != null) {
    throw new Mt5ConnectorError("UNAUTHORIZED", 401, "Unauthorized");
  }
  if (c.status === "PAUSED" && !allowPaused) {
    throw new Mt5ConnectorError("PAUSED", 409, "Sync is paused for this account. Resume it in Traditorium (Settings → Integrations).");
  }
  const convention = parseConvention(c.timeConventionJson);
  if (!convention) throw new Mt5ConnectorError("TIME_CONVENTION_MISSING", 409, "This connection has no server-time convention. Re-pair the terminal.");
  return { ...c, convention };
}

export interface IngestItemIssue {
  kind: "deal" | "order";
  index: number | null;
  ticket: string | null;
  message: string;
}

export interface IngestResponse {
  accepted: true;
  replayed: boolean;
  batchId: string;
  deals: { received: number; inserted: number; duplicates: number };
  orders: { received: number; inserted: number; duplicates: number };
  positionEvents: { received: number; inserted: number };
  positionsRederived: number;
  conflicts: IngestItemIssue[];
  rejected: IngestItemIssue[];
  cursor: { lastDealTimeMsc: string | null };
  backfill: { completed: boolean };
}

function ticketOf(item: unknown): string | null {
  return item && typeof item === "object" && typeof (item as { ticket?: unknown }).ticket === "string" ? (item as { ticket: string }).ticket : null;
}

function issueMessage(error: { issues: { path: PropertyKey[]; message: string }[] }): string {
  const i = error.issues[0];
  return i ? `${i.path.map(String).join(".") || "record"}: ${i.message}` : "Invalid record.";
}

interface Prepared<T> {
  items: { value: T; raw: unknown }[];
  rejected: IngestItemIssue[];
  duplicates: number;
  conflicts: IngestItemIssue[];
}

function prepareDeals(items: unknown[]): Prepared<NormalizedDeal> {
  const out: Prepared<NormalizedDeal> = { items: [], rejected: [], duplicates: 0, conflicts: [] };
  const seen = new Map<string, string>();
  items.forEach((item, index) => {
    const parsed = mt5DealWireSchema.safeParse(item);
    if (!parsed.success) return void out.rejected.push({ kind: "deal", index, ticket: ticketOf(item), message: issueMessage(parsed.error) });
    const n = normalizeDeal(parsed.data);
    if (!n.ok) return void out.rejected.push({ kind: "deal", index, ticket: parsed.data.ticket, message: n.message });
    const prior = seen.get(n.value.ticket);
    if (prior !== undefined) {
      if (prior === n.value.payloadHash) out.duplicates += 1;
      else out.conflicts.push({ kind: "deal", index, ticket: n.value.ticket, message: "Same ticket sent twice in one batch with different content; the first copy was used." });
      return;
    }
    seen.set(n.value.ticket, n.value.payloadHash);
    out.items.push({ value: n.value, raw: item });
  });
  return out;
}

function prepareOrders(items: unknown[]): Prepared<NormalizedOrder> {
  const out: Prepared<NormalizedOrder> = { items: [], rejected: [], duplicates: 0, conflicts: [] };
  const seen = new Map<string, string>();
  items.forEach((item, index) => {
    const parsed = mt5OrderWireSchema.safeParse(item);
    if (!parsed.success) return void out.rejected.push({ kind: "order", index, ticket: ticketOf(item), message: issueMessage(parsed.error) });
    const n = normalizeOrder(parsed.data);
    if (!n.ok) return void out.rejected.push({ kind: "order", index, ticket: parsed.data.ticket, message: n.message });
    const prior = seen.get(n.value.ticket);
    if (prior !== undefined) {
      if (prior === n.value.payloadHash) out.duplicates += 1;
      else out.conflicts.push({ kind: "order", index, ticket: n.value.ticket, message: "Same ticket sent twice in one batch with different content; the first copy was used." });
      return;
    }
    seen.set(n.value.ticket, n.value.payloadHash);
    out.items.push({ value: n.value, raw: item });
  });
  return out;
}

const STORED_CONFLICT = "Ticket already stored with different content; the original broker record was kept.";

async function insertDeals(tx: TransactionClient, connectionId: string, batchId: string, prepared: Prepared<NormalizedDeal>, convention: ServerTimeConvention) {
  const tickets = prepared.items.map((i) => i.value.ticket);
  const existing = tickets.length
    ? await tx.mt5Deal.findMany({ where: { connectionId, ticket: { in: tickets } }, select: { ticket: true, payloadHash: true } })
    : [];
  const stored = new Map(existing.map((e) => [e.ticket, e.payloadHash]));
  let duplicates = prepared.duplicates;
  const conflicts = [...prepared.conflicts];
  const fresh: { value: NormalizedDeal; raw: unknown }[] = [];
  for (const item of prepared.items) {
    const hash = stored.get(item.value.ticket);
    if (hash === undefined) fresh.push(item);
    else if (hash === item.value.payloadHash) duplicates += 1;
    else conflicts.push({ kind: "deal", index: null, ticket: item.value.ticket, message: STORED_CONFLICT });
  }
  const rows: Prisma.Mt5DealCreateManyInput[] = fresh.map(({ value: d, raw }) => {
    const { utc, offsetMinutes } = serverTimeToUtc(d.timeMsc, convention);
    return {
      connectionId,
      ticket: d.ticket,
      orderTicket: d.orderTicket,
      positionId: d.positionId,
      timeMsc: d.timeMsc,
      serverTime: serverWallClock(d.timeMsc),
      occurredAt: utc,
      utcOffsetMinutes: offsetMinutes,
      type: d.type,
      category: d.category,
      side: d.side,
      entry: d.entry,
      reason: d.reason,
      symbol: d.symbol,
      volume: d.volume,
      price: d.price,
      profit: d.profit,
      commission: d.commission,
      swap: d.swap,
      fee: d.fee,
      stopLoss: d.stopLoss,
      takeProfit: d.takeProfit,
      magic: d.magic,
      comment: d.comment,
      externalId: d.externalId,
      raw: raw as Prisma.InputJsonValue,
      payloadHash: d.payloadHash,
      batchId,
    };
  });
  const inserted = rows.length ? (await tx.mt5Deal.createMany({ data: rows, skipDuplicates: true })).count : 0;
  return { inserted, duplicates, conflicts, fresh: fresh.map((f) => f.value) };
}

async function insertOrders(tx: TransactionClient, connectionId: string, batchId: string, prepared: Prepared<NormalizedOrder>, convention: ServerTimeConvention) {
  const tickets = prepared.items.map((i) => i.value.ticket);
  const existing = tickets.length
    ? await tx.mt5Order.findMany({ where: { connectionId, ticket: { in: tickets } }, select: { ticket: true, payloadHash: true } })
    : [];
  const stored = new Map(existing.map((e) => [e.ticket, e.payloadHash]));
  let duplicates = prepared.duplicates;
  const conflicts = [...prepared.conflicts];
  const fresh: { value: NormalizedOrder; raw: unknown }[] = [];
  for (const item of prepared.items) {
    const hash = stored.get(item.value.ticket);
    if (hash === undefined) fresh.push(item);
    else if (hash === item.value.payloadHash) duplicates += 1;
    else conflicts.push({ kind: "order", index: null, ticket: item.value.ticket, message: STORED_CONFLICT });
  }
  const at = (msc: bigint | null) => (msc == null ? null : serverTimeToUtc(msc, convention).utc);
  const rows: Prisma.Mt5OrderCreateManyInput[] = fresh.map(({ value: o, raw }) => ({
    connectionId,
    ticket: o.ticket,
    positionId: o.positionId,
    positionById: o.positionById,
    type: o.type,
    state: o.state,
    reason: o.reason,
    symbol: o.symbol,
    timeSetupMsc: o.timeSetupMsc,
    timeDoneMsc: o.timeDoneMsc,
    setupAt: at(o.timeSetupMsc),
    doneAt: at(o.timeDoneMsc),
    volumeInitial: o.volumeInitial,
    volumeCurrent: o.volumeCurrent,
    priceOpen: o.priceOpen,
    priceStopLimit: o.priceStopLimit,
    stopLoss: o.stopLoss,
    takeProfit: o.takeProfit,
    magic: o.magic,
    comment: o.comment,
    externalId: o.externalId,
    raw: raw as Prisma.InputJsonValue,
    payloadHash: o.payloadHash,
    batchId,
  }));
  const inserted = rows.length ? (await tx.mt5Order.createMany({ data: rows, skipDuplicates: true })).count : 0;
  return { inserted, duplicates, conflicts, fresh: fresh.map((f) => f.value) };
}

function stopStateFromRaw(raw: unknown, key: "sl"): DerivationDeal["stopLossState"] {
  const value = raw && typeof raw === "object" ? (raw as Record<string, unknown>)[key] : undefined;
  try {
    return stopField(typeof value === "string" ? value : null).state;
  } catch {
    return "ABSENT";
  }
}

const s = (v: Prisma.Decimal | null) => (v == null ? null : v.toString());

/**
 * Re-derives the given positions from ALL of their stored deals (and the
 * orders that opened them). Positions whose inputs are unchanged (same
 * sourceHash and derivation version) are left untouched. Returns how many
 * rows were written or removed.
 */
export async function rederivePositions(tx: TransactionClient, connectionId: string, positionIds: string[], convention: ServerTimeConvention): Promise<number> {
  const unique = [...new Set(positionIds)];
  let written = 0;
  for (let i = 0; i < unique.length; i += 200) {
    const chunk = unique.slice(i, i + 200);
    const deals = await tx.mt5Deal.findMany({
      where: { connectionId, positionId: { in: chunk } },
      select: {
        ticket: true,
        orderTicket: true,
        positionId: true,
        timeMsc: true,
        category: true,
        side: true,
        entry: true,
        symbol: true,
        volume: true,
        price: true,
        profit: true,
        commission: true,
        swap: true,
        fee: true,
        stopLoss: true,
        takeProfit: true,
        payloadHash: true,
        raw: true,
      },
    });
    const orderTickets = [...new Set(deals.map((d) => d.orderTicket).filter((t): t is string => t != null))];
    const orders = await tx.mt5Order.findMany({
      where: { connectionId, OR: [{ positionId: { in: chunk } }, ...(orderTickets.length ? [{ ticket: { in: orderTickets } }] : [])] },
      select: { ticket: true, positionId: true, stopLoss: true, takeProfit: true, payloadHash: true, raw: true },
    });
    const existing = await tx.mt5Position.findMany({
      where: { connectionId, positionId: { in: chunk } },
      select: { positionId: true, sourceHash: true, derivationVersion: true },
    });
    const existingById = new Map(existing.map((e) => [e.positionId, e]));

    for (const positionId of chunk) {
      const pd = deals.filter((d) => d.positionId === positionId);
      const ownOrderTickets = new Set(pd.map((d) => d.orderTicket));
      const po = orders.filter((o) => o.positionId === positionId || ownOrderTickets.has(o.ticket));
      const derivationDeals: DerivationDeal[] = pd.map((d) => ({
        ticket: d.ticket,
        orderTicket: d.orderTicket,
        timeMsc: d.timeMsc,
        category: d.category,
        side: d.side,
        entry: d.entry,
        symbol: d.symbol,
        volume: s(d.volume),
        price: s(d.price),
        profit: d.profit.toString(),
        commission: d.commission.toString(),
        swap: d.swap.toString(),
        fee: d.fee.toString(),
        stopLoss: s(d.stopLoss),
        stopLossState: stopStateFromRaw(d.raw, "sl"),
        takeProfit: s(d.takeProfit),
        payloadHash: d.payloadHash,
      }));
      const derivationOrders: DerivationOrder[] = po.map((o) => ({
        ticket: o.ticket,
        stopLoss: s(o.stopLoss),
        stopLossState: stopStateFromRaw(o.raw, "sl"),
        takeProfit: s(o.takeProfit),
        payloadHash: o.payloadHash,
      }));
      const derived = derivePosition(positionId, derivationDeals, derivationOrders);
      const prior = existingById.get(positionId);
      if (!derived) {
        if (prior) {
          await tx.mt5Position.delete({ where: { connectionId_positionId: { connectionId, positionId } } });
          written += 1;
        }
        continue;
      }
      if (prior && prior.sourceHash === derived.sourceHash && prior.derivationVersion === MT5_POSITION_DERIVATION_VERSION) continue;
      const utc = (msc: bigint | null) => (msc == null ? null : serverTimeToUtc(msc, convention).utc);
      const data = {
        symbol: derived.symbol,
        direction: derived.direction,
        status: derived.status,
        openedMsc: derived.openedMsc,
        openedAt: utc(derived.openedMsc),
        closedMsc: derived.closedMsc,
        closedAt: utc(derived.closedMsc),
        volumeIn: derived.volumeIn,
        volumeOut: derived.volumeOut,
        openVolume: derived.openVolume,
        avgEntryPrice: derived.avgEntryPrice,
        avgExitPrice: derived.avgExitPrice,
        profit: derived.profit,
        commission: derived.commission,
        swap: derived.swap,
        fee: derived.fee,
        netProfit: derived.netProfit,
        dealCount: derived.dealCount,
        entryCount: derived.entryCount,
        exitCount: derived.exitCount,
        reversalCount: derived.reversalCount,
        initialStopLoss: derived.initialStopLoss,
        initialTakeProfit: derived.initialTakeProfit,
        initialStopSource: derived.initialStopSource,
        segments: derived.segments as unknown as Prisma.InputJsonValue,
        flags: derived.flags,
        derivationVersion: derived.derivationVersion,
        sourceHash: derived.sourceHash,
        derivedAt: new Date(),
      };
      await tx.mt5Position.upsert({
        where: { connectionId_positionId: { connectionId, positionId } },
        create: { connectionId, positionId, ...data },
        update: data,
      });
      written += 1;
    }
  }
  return written;
}

const minBig = (a: bigint | null, b: bigint | null) => (a == null ? b : b == null ? a : a < b ? a : b);
const maxBig = (a: bigint | null, b: bigint | null) => (a == null ? b : b == null ? a : a > b ? a : b);

interface IngestInput {
  kind: "BACKFILL" | "RECONCILE" | "LIVE";
  batchSeq?: number | null;
  rangeFromMsc?: string | number | null;
  rangeToMsc?: string | number | null;
  isFinal: boolean;
  deals: unknown[];
  orders: unknown[];
  positionChanges: Mt5EventsRequest["positionChanges"];
}

async function ingest(connection: AuthenticatedMt5Connection, input: IngestInput, idempotencyKey: string, rawBody: unknown, now: Date): Promise<IngestResponse> {
  assertLiveIngestScope();
  const requestHash = payloadHash(rawBody);

  return prisma.$transaction(async (tx) => {
    const locked = await loadLockedConnection(tx, connection.id);
    const prior = await tx.mt5SyncBatch.findUnique({
      where: { connectionId_idempotencyKey: { connectionId: connection.id, idempotencyKey } },
      select: { requestHash: true, responseJson: true },
    });
    if (prior) {
      if (prior.requestHash !== requestHash) {
        throw new Mt5ConnectorError("IDEMPOTENCY_CONFLICT", 409, "This Idempotency-Key was already used with a different request body.");
      }
      return { ...(prior.responseJson as unknown as IngestResponse), replayed: true };
    }

    const batch = await tx.mt5SyncBatch.create({
      data: {
        connectionId: connection.id,
        kind: input.kind,
        idempotencyKey,
        requestHash,
        batchSeq: input.batchSeq ?? null,
        rangeFromMsc: input.rangeFromMsc == null ? null : BigInt(input.rangeFromMsc),
        rangeToMsc: input.rangeToMsc == null ? null : BigInt(input.rangeToMsc),
        isFinal: input.isFinal,
        responseJson: {},
      },
      select: { id: true },
    });

    const preparedDeals = prepareDeals(input.deals);
    const preparedOrders = prepareOrders(input.orders);
    const deals = await insertDeals(tx, connection.id, batch.id, preparedDeals, locked.convention);
    const orders = await insertOrders(tx, connection.id, batch.id, preparedOrders, locked.convention);

    // Live SL/TP observations (events endpoint only).
    let eventsInserted = 0;
    const touched = new Set<string>();
    if (input.positionChanges.length) {
      const rows = input.positionChanges.map((c) => {
        const observedMsc = BigInt(c.observedAtMsc);
        return {
          connectionId: connection.id,
          positionId: c.positionId,
          stopLoss: stopField(c.sl).level,
          takeProfit: stopField(c.tp).level,
          observedMsc,
          observedAt: serverTimeToUtc(observedMsc, locked.convention).utc,
          raw: c as unknown as Prisma.InputJsonValue,
        };
      });
      eventsInserted = (await tx.mt5PositionEvent.createMany({ data: rows, skipDuplicates: true })).count;
      for (const r of rows) {
        await tx.mt5Position.updateMany({
          where: { connectionId: connection.id, positionId: r.positionId, OR: [{ liveObservedAt: null }, { liveObservedAt: { lte: r.observedAt } }] },
          data: { liveStopLoss: r.stopLoss, liveTakeProfit: r.takeProfit, liveObservedAt: r.observedAt },
        });
      }
    }

    for (const d of deals.fresh) if (d.positionId) touched.add(d.positionId);
    for (const o of orders.fresh) if (o.positionId) touched.add(o.positionId);
    const positionsRederived = await rederivePositions(tx, connection.id, [...touched], locked.convention);

    let fromMsc = locked.historyFromMsc;
    let toMsc = locked.historyToMsc;
    let lastDeal = locked.lastDealTimeMsc;
    for (const d of deals.fresh) {
      fromMsc = minBig(fromMsc, d.timeMsc);
      toMsc = maxBig(toMsc, d.timeMsc);
      lastDeal = maxBig(lastDeal, d.timeMsc);
    }
    const backfillDone = locked.backfillCompletedAt != null || (input.kind === "BACKFILL" && input.isFinal);
    await tx.mt5Connection.update({
      where: { id: connection.id },
      data: {
        lastSyncedAt: now,
        historyFromMsc: fromMsc,
        historyToMsc: toMsc,
        lastDealTimeMsc: lastDeal,
        ...(input.kind === "BACKFILL" && input.isFinal && !locked.backfillCompletedAt ? { backfillCompletedAt: now } : {}),
      },
    });

    const response: IngestResponse = {
      accepted: true,
      replayed: false,
      batchId: batch.id,
      deals: { received: input.deals.length, inserted: deals.inserted, duplicates: deals.duplicates },
      orders: { received: input.orders.length, inserted: orders.inserted, duplicates: orders.duplicates },
      positionEvents: { received: input.positionChanges.length, inserted: eventsInserted },
      positionsRederived,
      conflicts: [...deals.conflicts, ...orders.conflicts],
      rejected: [...preparedDeals.rejected, ...preparedOrders.rejected],
      cursor: { lastDealTimeMsc: lastDeal?.toString() ?? null },
      backfill: { completed: backfillDone },
    };
    await tx.mt5SyncBatch.update({
      where: { id: batch.id },
      data: {
        receivedDeals: response.deals.received,
        insertedDeals: response.deals.inserted,
        duplicateDeals: response.deals.duplicates,
        receivedOrders: response.orders.received,
        insertedOrders: response.orders.inserted,
        duplicateOrders: response.orders.duplicates,
        conflicts: response.conflicts.length,
        responseJson: response as unknown as Prisma.InputJsonValue,
      },
    });
    return response;
  }, TX_OPTIONS);
}

export function ingestHistory(connection: AuthenticatedMt5Connection, req: Mt5HistoryRequest, idempotencyKey: string, rawBody: unknown, now = new Date()) {
  return ingest(
    connection,
    { kind: req.kind, batchSeq: req.batchSeq, rangeFromMsc: req.rangeFromMsc, rangeToMsc: req.rangeToMsc, isFinal: req.isFinal, deals: req.deals, orders: req.orders, positionChanges: [] },
    idempotencyKey,
    rawBody,
    now,
  );
}

export function ingestEvents(connection: AuthenticatedMt5Connection, req: Mt5EventsRequest, idempotencyKey: string, rawBody: unknown, now = new Date()) {
  return ingest(
    connection,
    { kind: "LIVE", isFinal: false, deals: req.deals, orders: req.orders, positionChanges: req.positionChanges },
    idempotencyKey,
    rawBody,
    now,
  );
}

export interface HeartbeatResponse {
  status: "ACTIVE" | "PAUSED";
  connectionId: string;
  serverTime: string;
  backfill: { required: boolean; completedAt: string | null };
  cursor: { lastDealTimeMsc: string | null };
  config: ReturnType<typeof connectorConfig>;
}

/** Records liveness + (throttled) account snapshot + live open-position
 *  state. Allowed while PAUSED (so the terminal learns it is paused), but
 *  then stores nothing except the heartbeat time. */
export async function recordHeartbeat(connection: AuthenticatedMt5Connection, req: Mt5HeartbeatRequest, now = new Date()): Promise<HeartbeatResponse> {
  assertLiveIngestScope();
  return prisma.$transaction(async (tx) => {
    const locked = await loadLockedConnection(tx, connection.id, true);
    await tx.mt5Connection.update({
      where: { id: connection.id },
      data: {
        lastHeartbeatAt: now,
        ...(req.gmtOffsetSeconds != null ? { observedOffsetMinutes: roundOffsetToQuarterHour(req.gmtOffsetSeconds) } : {}),
        ...(req.eaVersion ? { eaVersion: req.eaVersion } : {}),
        ...(req.build != null ? { terminalBuild: req.build } : {}),
      },
    });
    const base = {
      connectionId: connection.id,
      serverTime: now.toISOString(),
      backfill: { required: locked.backfillCompletedAt == null, completedAt: locked.backfillCompletedAt?.toISOString() ?? null },
      cursor: { lastDealTimeMsc: locked.lastDealTimeMsc?.toString() ?? null },
      config: connectorConfig(),
    };
    if (locked.status === "PAUSED") return { status: "PAUSED" as const, ...base };

    const last = await tx.mt5AccountSnapshot.findFirst({ where: { connectionId: connection.id }, orderBy: { capturedAt: "desc" }, select: { capturedAt: true } });
    if (!last || now.getTime() - last.capturedAt.getTime() >= SNAPSHOT_MIN_INTERVAL_MS) {
      await tx.mt5AccountSnapshot.create({
        data: {
          connectionId: connection.id,
          balance: req.snapshot.balance,
          equity: req.snapshot.equity,
          margin: req.snapshot.margin,
          freeMargin: req.snapshot.freeMargin,
          credit: req.snapshot.credit,
          profit: req.snapshot.profit,
          openPositions: req.openPositions as unknown as Prisma.InputJsonValue,
          serverTimeMsc: req.serverTimeMsc == null ? null : BigInt(req.serverTimeMsc),
          capturedAt: now,
        },
      });
    }

    const openIds = req.openPositions.map((p) => p.positionId);
    await tx.mt5Position.updateMany({
      where: { connectionId: connection.id, liveOpen: true, ...(openIds.length ? { positionId: { notIn: openIds } } : {}) },
      data: { liveOpen: false },
    });
    for (const p of req.openPositions) {
      await tx.mt5Position.updateMany({
        where: { connectionId: connection.id, positionId: p.positionId },
        data: {
          liveOpen: true,
          liveStopLoss: stopField(p.sl).level,
          liveTakeProfit: stopField(p.tp).level,
          liveCurrentPrice: p.priceCurrent ?? null,
          liveProfit: p.profit ?? null,
          liveObservedAt: now,
        },
      });
    }
    return { status: "ACTIVE" as const, ...base };
  }, TX_OPTIONS);
}

export async function upsertSymbolSpecs(connection: AuthenticatedMt5Connection, req: Mt5SymbolsRequest): Promise<{ upserted: number }> {
  assertLiveIngestScope();
  return prisma.$transaction(async (tx) => {
    await loadLockedConnection(tx, connection.id);
    for (const spec of req.specs) {
      const data = {
        description: spec.description ?? null,
        digits: spec.digits ?? null,
        contractSize: spec.contractSize ?? null,
        tickSize: spec.tickSize ?? null,
        tickValue: spec.tickValue ?? null,
        volumeMin: spec.volumeMin ?? null,
        volumeMax: spec.volumeMax ?? null,
        volumeStep: spec.volumeStep ?? null,
        currencyBase: spec.currencyBase ?? null,
        currencyProfit: spec.currencyProfit ?? null,
        currencyMargin: spec.currencyMargin ?? null,
        raw: spec as unknown as Prisma.InputJsonValue,
      };
      await tx.mt5SymbolSpec.upsert({
        where: { connectionId_symbol: { connectionId: connection.id, symbol: spec.symbol } },
        create: { connectionId: connection.id, symbol: spec.symbol, ...data },
        update: data,
      });
    }
    return { upserted: req.specs.length };
  }, TX_OPTIONS);
}

/**
 * Web-side: the trader corrects how server times map to UTC. Re-normalizes
 * the derived UTC columns of every stored deal, order and position from the
 * untouched raw server times (the immutability trigger allows exactly
 * those columns to change). Raw records are never altered.
 */
export async function setTimeConvention(userId: string, connectionId: string, input: unknown): Promise<{ updatedDeals: number }> {
  assertLiveIngestScope();
  const parsed = mt5TimeConventionInputSchema.safeParse(input);
  if (!parsed.success) throw new Mt5ConnectorError("VALIDATION", 422, parsed.error.issues[0]?.message ?? "Invalid time convention.");
  const convention = parseConvention({ ...parsed.data, source: "USER_SELECTED" });
  if (!convention) throw new Mt5ConnectorError("VALIDATION", 422, "Unknown or invalid time zone.");
  const owned = await prisma.mt5Connection.findFirst({ where: { id: connectionId, userId }, select: { id: true } });
  if (!owned) throw new Mt5ConnectorError("NOT_FOUND", 404, "MT5 connection not found.");

  return prisma.$transaction(
    async (tx) => {
      await lockConnection(tx, connectionId);
      await tx.mt5Connection.update({ where: { id: connectionId }, data: { timeConventionJson: convention as unknown as Prisma.InputJsonValue } });
      let updatedDeals = 0;
      let cursor: string | undefined;
      for (;;) {
        const page = await tx.mt5Deal.findMany({
          where: { connectionId },
          orderBy: { id: "asc" },
          take: 1000,
          ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
          select: { id: true, timeMsc: true, occurredAt: true },
        });
        if (page.length === 0) break;
        for (const d of page) {
          const { utc, offsetMinutes } = serverTimeToUtc(d.timeMsc, convention);
          if (utc.getTime() !== d.occurredAt.getTime()) {
            await tx.mt5Deal.update({ where: { id: d.id }, data: { occurredAt: utc, utcOffsetMinutes: offsetMinutes } });
            updatedDeals += 1;
          }
        }
        cursor = page[page.length - 1]!.id;
      }
      const at = (msc: bigint | null) => (msc == null ? null : serverTimeToUtc(msc, convention).utc);
      const orders = await tx.mt5Order.findMany({ where: { connectionId }, select: { id: true, timeSetupMsc: true, timeDoneMsc: true } });
      for (const o of orders) await tx.mt5Order.update({ where: { id: o.id }, data: { setupAt: at(o.timeSetupMsc), doneAt: at(o.timeDoneMsc) } });
      const positions = await tx.mt5Position.findMany({ where: { connectionId }, select: { id: true, openedMsc: true, closedMsc: true } });
      for (const p of positions) await tx.mt5Position.update({ where: { id: p.id }, data: { openedAt: at(p.openedMsc), closedAt: at(p.closedMsc) } });
      return { updatedDeals };
    },
    { timeout: 120_000, maxWait: 15_000 },
  );
}
