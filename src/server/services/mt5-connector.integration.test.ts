import { afterAll, describe, expect, it } from "vitest";

import { prisma } from "@/server/db";
import { createTestUser, deleteTestUsers } from "@/server/testing/cleanup";
import { requireApiUser } from "@/server/api-auth";
import { createApiToken } from "@/server/services/api-tokens.service";
import { archiveTradingAccount, createBrokerageAccount, getAccountBalance } from "@/server/services/accounts.service";
import { createPropFirmAccount, createUserPropFirm, deletePropFirmAccount } from "@/server/services/prop-firms.service";
import { deleteDataSection } from "@/server/services/data-management.service";
import { confirmImport, previewImport } from "@/server/services/prop-firm-import.service";
import {
  assertStatementImportAllowed,
  deleteMt5BrokerHistory,
  getBrokerHistory,
  issuePairingCode,
  listMt5AccountOptions,
  pairMt5Terminal,
  pauseMt5Connection,
  PAIRING_RATE_LIMIT,
  resumeMt5Connection,
  revokeMt5Connection,
} from "@/server/services/mt5-connector.service";
import { ingestHistory, setTimeConvention } from "@/server/services/mt5-sync.service";
import { authenticateMt5Request } from "@/server/mt5-connector-auth";
import { backtestScope, runInWorkspaceScope, runLive } from "@/server/workspace/scope";
import { POST as pairRoute } from "@/app/api/v1/mt5/pair/route";
import { POST as heartbeatRoute } from "@/app/api/v1/mt5/heartbeat/route";
import { POST as historyRoute } from "@/app/api/v1/mt5/history/route";
import { POST as eventsRoute } from "@/app/api/v1/mt5/events/route";
import { POST as symbolsRoute } from "@/app/api/v1/mt5/symbols/route";
import type { Mt5PairRequest } from "@/lib/validation/mt5-connector";

/**
 * MT5 Connector (Stage 1) — DB-backed integration tests against the
 * dedicated trading_hub_test database. Real routes, real services, real
 * triggers. Nothing here mocks the database.
 */

const userIds: string[] = [];
afterAll(() => deleteTestUsers(...userIds));

let ipCounter = 0;
const freshIp = () => `10.${Math.floor(Math.random() * 200)}.${++ipCounter % 250}.${Math.floor(Math.random() * 250)}`;

async function makeUser(label: string) {
  const user = await createTestUser(`mt5-${label}`);
  userIds.push(user.id);
  return user;
}

async function brokerageAccount(userId: string, name = "MT5 Broker") {
  return createBrokerageAccount(userId, { name, brokerName: "Demo Broker", startingBalance: 10_000 } as never);
}

const terminal = (login = "5001234", server = "Demo-Server"): Mt5PairRequest["terminal"] => ({
  login,
  server,
  company: "Demo Broker Ltd",
  name: "Test Trader",
  currency: "USD",
  currencyDigits: 2,
  leverage: 100,
  marginMode: "HEDGING",
  tradeMode: "DEMO",
  build: 4410,
  eaVersion: "1.00",
  gmtOffsetSeconds: 7200,
});

async function pairedConnection(label: string, login = "5001234", server = "Demo-Server") {
  const user = await makeUser(label);
  const account = await brokerageAccount(user.id);
  const { code, connectionId } = await issuePairingCode(user.id, account.id);
  const paired = await pairMt5Terminal({ pairingCode: code, terminal: terminal(login, server) }, freshIp());
  return { user, account, connectionId, token: paired.deviceToken, identity: { login, server } };
}

function post(path: string, body: unknown, headers: Record<string, string> = {}) {
  return new Request(`http://localhost${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
}

const auth = (token: string, key?: string) => ({ authorization: `Bearer ${token}`, ...(key ? { "idempotency-key": key } : {}) });

const T0 = Date.parse("2024-01-15T10:00:00Z"); // server wall clock
const buyIn = (ticket: string, position: string, t: number, extra: Record<string, unknown> = {}) => ({
  ticket,
  order: position,
  positionId: position,
  timeMsc: T0 + t,
  type: "DEAL_TYPE_BUY",
  entry: "DEAL_ENTRY_IN",
  symbol: "EURUSD",
  volume: "1.00",
  price: "1.10000",
  commission: "-3.50",
  sl: "1.09500",
  ...extra,
});
const sellOut = (ticket: string, position: string, t: number, extra: Record<string, unknown> = {}) => ({
  ticket,
  order: String(Number(ticket) + 1000),
  positionId: position,
  timeMsc: T0 + t,
  type: "DEAL_TYPE_SELL",
  entry: "DEAL_ENTRY_OUT",
  symbol: "EURUSD",
  volume: "1.00",
  price: "1.10200",
  profit: "200.00",
  commission: "-3.50",
  swap: "-0.80",
  ...extra,
});
const deposit = (ticket: string, t: number, amount = "10000.00") => ({ ticket, timeMsc: T0 + t, type: "DEAL_TYPE_BALANCE", positionId: "0", profit: amount, comment: "Deposit" });

function historyBody(identity: { login: string; server: string }, deals: unknown[], extra: Record<string, unknown> = {}) {
  return { account: identity, kind: "BACKFILL", isFinal: false, deals, orders: [], ...extra };
}

// ── Pairing ────────────────────────────────────────────────────────────────

describe("MT5 pairing", () => {
  it("issues a single-use code that becomes a td_mt5_ device token bound to login + server", async () => {
    const user = await makeUser("pair");
    const account = await brokerageAccount(user.id);
    const { code, expiresAt } = await issuePairingCode(user.id, account.id);
    expect(code).toMatch(/^[2-9A-Z]{4}-[2-9A-Z]{4}$/);
    expect(expiresAt.getTime()).toBeGreaterThan(Date.now());

    const ip = freshIp();
    const res = await pairRoute(post("/api/v1/mt5/pair", { pairingCode: code.toLowerCase().replace("-", " "), terminal: terminal() }, { "x-forwarded-for": ip }));
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.deviceToken).toMatch(/^td_mt5_/);
    expect(body.account).toEqual({ login: "5001234", server: "Demo-Server" });
    expect(JSON.stringify(body)).not.toMatch(/password/i);

    const stored = await prisma.mt5Connection.findUniqueOrThrow({ where: { id: body.connectionId } });
    expect(stored.status).toBe("ACTIVE");
    expect(stored.tokenHash).not.toBe(body.deviceToken);
    expect(stored.tokenHash).toMatch(/^[0-9a-f]{64}$/);
    expect(stored.pairingCodeHash).toBeNull();
    expect(stored.marginMode).toBe("HEDGING");
    expect(stored.timeConventionJson).toMatchObject({ kind: "FIXED_OFFSET", offsetMinutes: 120 });

    // Single use: the same code can't be exchanged twice.
    const again = await pairRoute(post("/api/v1/mt5/pair", { pairingCode: code, terminal: terminal() }, { "x-forwarded-for": freshIp() }));
    expect(again.status).toBe(410);
  });

  it("rejects an expired code", async () => {
    const user = await makeUser("expired");
    const account = await brokerageAccount(user.id);
    const { code } = await issuePairingCode(user.id, account.id, new Date(Date.now() - 11 * 60 * 1000));
    await expect(pairMt5Terminal({ pairingCode: code, terminal: terminal() }, freshIp())).rejects.toMatchObject({ code: "PAIRING_CODE_INVALID", status: 410 });
  });

  it("concurrent use of one code yields exactly one token", async () => {
    const user = await makeUser("race");
    const account = await brokerageAccount(user.id);
    const { code } = await issuePairingCode(user.id, account.id);
    const results = await Promise.allSettled([
      pairMt5Terminal({ pairingCode: code, terminal: terminal() }, freshIp()),
      pairMt5Terminal({ pairingCode: code, terminal: terminal() }, freshIp()),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
  });

  it("rate-limits failed attempts per client IP", async () => {
    const ip = freshIp();
    for (let i = 0; i < PAIRING_RATE_LIMIT.maxFailures; i++) {
      const res = await pairRoute(post("/api/v1/mt5/pair", { pairingCode: "ZZZZ-ZZZZ", terminal: terminal() }, { "x-forwarded-for": ip }));
      expect(res.status).toBe(410);
    }
    const blocked = await pairRoute(post("/api/v1/mt5/pair", { pairingCode: "ZZZZ-ZZZZ", terminal: terminal() }, { "x-forwarded-for": ip }));
    expect(blocked.status).toBe(429);
    // Another IP is unaffected.
    const other = await pairRoute(post("/api/v1/mt5/pair", { pairingCode: "ZZZZ-ZZZZ", terminal: terminal() }, { "x-forwarded-for": freshIp() }));
    expect(other.status).toBe(410);
  });

  it("refuses the Performance Account and a second connection of the same MT5 login", async () => {
    const { user } = await pairedConnection("dup");
    const perf = await prisma.tradingAccount.create({ data: { userId: user.id, kind: "PERFORMANCE", name: "Performance Account", startingBalance: 100000 } });
    await expect(issuePairingCode(user.id, perf.id)).rejects.toMatchObject({ code: "NOT_CONNECTABLE" });
    const second = await brokerageAccount(user.id, "Second");
    const { code } = await issuePairingCode(user.id, second.id);
    await expect(pairMt5Terminal({ pairingCode: code, terminal: terminal() }, freshIp())).rejects.toMatchObject({ code: "ALREADY_CONNECTED" });
  });

  it("re-pairing after disconnect must present the same login + server", async () => {
    const { user, account, connectionId } = await pairedConnection("repair", "777", "Srv-A");
    await revokeMt5Connection(user.id, connectionId);
    const { code } = await issuePairingCode(user.id, account.id);
    await expect(pairMt5Terminal({ pairingCode: code, terminal: terminal("888", "Srv-A") }, freshIp())).rejects.toMatchObject({ code: "IDENTITY_MISMATCH" });
    const ok = await pairMt5Terminal({ pairingCode: code, terminal: terminal("777", "Srv-A") }, freshIp());
    expect(ok.connectionId).toBe(connectionId);
  });
});

// ── Authentication & authorization ─────────────────────────────────────────

describe("MT5 token isolation, revocation and identity binding", () => {
  it("an MT5 token cannot authenticate the ordinary API, and an API token cannot ingest", async () => {
    const { user, token, identity } = await pairedConnection("isolation");
    const apiCheck = await requireApiUser(new Request("http://localhost/api/v1/me", { headers: { authorization: `Bearer ${token}` } }));
    expect(apiCheck.ok).toBe(false);

    const { rawToken } = await createApiToken(user.id, "extension");
    const res = await historyRoute(post("/api/v1/mt5/history", historyBody(identity, []), auth(rawToken, "k1")));
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "Unauthorized", code: "UNAUTHORIZED" });
  });

  it("revocation stops the token immediately", async () => {
    const { user, connectionId, token, identity } = await pairedConnection("revoke");
    const ok = await heartbeatRoute(post("/api/v1/mt5/heartbeat", { account: identity, snapshot: { balance: "1", equity: "1", margin: "0", freeMargin: "1" } }, auth(token)));
    expect(ok.status).toBe(200);
    await revokeMt5Connection(user.id, connectionId);
    const denied = await heartbeatRoute(post("/api/v1/mt5/heartbeat", { account: identity, snapshot: { balance: "1", equity: "1", margin: "0", freeMargin: "1" } }, auth(token)));
    expect(denied.status).toBe(401);
    const row = await prisma.mt5Connection.findUniqueOrThrow({ where: { id: connectionId } });
    expect(row.tokenHash).toBeNull();
  });

  it("the DB refuses a token hash on a revoked connection", async () => {
    const { connectionId } = await pairedConnection("check");
    await expect(prisma.mt5Connection.update({ where: { id: connectionId }, data: { status: "REVOKED" } })).rejects.toThrow();
  });

  it("login/server mismatch is refused with 403", async () => {
    const { token } = await pairedConnection("mismatch", "1111", "Live-1");
    const res = await historyRoute(post("/api/v1/mt5/history", historyBody({ login: "2222", server: "Live-1" }, []), auth(token, "k1")));
    expect(res.status).toBe(403);
    expect((await res.json()).code).toBe("ACCOUNT_MISMATCH");
    const res2 = await historyRoute(post("/api/v1/mt5/history", historyBody({ login: "1111", server: "Other" }, []), auth(token, "k2")));
    expect(res2.status).toBe(403);
  });

  it("pause refuses ingestion but heartbeat still reports PAUSED; resume restores it", async () => {
    const { user, connectionId, token, identity } = await pairedConnection("pause");
    await pauseMt5Connection(user.id, connectionId);
    const hb = await heartbeatRoute(post("/api/v1/mt5/heartbeat", { account: identity, snapshot: { balance: "1", equity: "1", margin: "0", freeMargin: "1" } }, auth(token)));
    expect((await hb.json()).status).toBe("PAUSED");
    const h = await historyRoute(post("/api/v1/mt5/history", historyBody(identity, [deposit("1", 0)]), auth(token, "p1")));
    expect(h.status).toBe(409);
    expect((await h.json()).code).toBe("PAUSED");
    await resumeMt5Connection(user.id, connectionId);
    const h2 = await historyRoute(post("/api/v1/mt5/history", historyBody(identity, [deposit("1", 0)]), auth(token, "p2")));
    expect(h2.status).toBe(200);
  });

  it("requires an Idempotency-Key and enforces the body size limit", async () => {
    const { token, identity } = await pairedConnection("limits");
    const noKey = await historyRoute(post("/api/v1/mt5/history", historyBody(identity, []), auth(token)));
    expect(noKey.status).toBe(400);
    const big = await historyRoute(
      new Request("http://localhost/api/v1/mt5/history", {
        method: "POST",
        headers: { "content-type": "application/json", ...auth(token, "big"), "content-length": String(3_000_000) },
        body: "{}",
      }),
    );
    expect(big.status).toBe(413);
    const tooMany = await historyRoute(post("/api/v1/mt5/history", historyBody(identity, Array.from({ length: 501 }, (_, i) => deposit(String(i + 1), i))), auth(token, "many")));
    expect(tooMany.status).toBe(422);
  });
});

// ── Ingestion ──────────────────────────────────────────────────────────────

describe("MT5 history ingestion", () => {
  it("stores raw deals, derives positions, and is idempotent per batch key", async () => {
    const { account, connectionId, token, identity } = await pairedConnection("ingest");
    const body = historyBody(identity, [deposit("100", 0), buyIn("101", "101", 1000), sellOut("102", "101", 60_000)], { isFinal: true });

    const res = await historyRoute(post("/api/v1/mt5/history", body, auth(token, "batch-1")));
    expect(res.status).toBe(200);
    const first = await res.json();
    expect(first).toMatchObject({ replayed: false, deals: { received: 3, inserted: 3, duplicates: 0 }, positionsRederived: 1, backfill: { completed: true } });

    // Exact retry → stored response replayed, nothing re-inserted.
    const replay = await (await historyRoute(post("/api/v1/mt5/history", body, auth(token, "batch-1")))).json();
    expect(replay).toMatchObject({ replayed: true, batchId: first.batchId });
    // Same key, different body → conflict.
    const conflict = await historyRoute(post("/api/v1/mt5/history", { ...body, isFinal: false }, auth(token, "batch-1")));
    expect(conflict.status).toBe(409);
    // Same deals under a new key → duplicates, not new rows.
    const dup = await (await historyRoute(post("/api/v1/mt5/history", body, auth(token, "batch-2")))).json();
    expect(dup.deals).toEqual({ received: 3, inserted: 0, duplicates: 3 });

    expect(await prisma.mt5Deal.count({ where: { connectionId } })).toBe(3);
    const position = await prisma.mt5Position.findUniqueOrThrow({ where: { connectionId_positionId: { connectionId, positionId: "101" } } });
    expect(position).toMatchObject({ status: "CLOSED", direction: "LONG", initialStopSource: "OPENING_DEAL" });
    expect(position.netProfit.toString()).toBe("192.2");
    expect(position.openedAt?.toISOString()).toBe("2024-01-15T08:00:01.000Z"); // GMT+2 convention
    const raw = await prisma.mt5Deal.findFirstOrThrow({ where: { connectionId, ticket: "101" } });
    expect(raw.raw).toMatchObject({ ticket: "101", price: "1.10000", commission: "-3.50" }); // original strings preserved
    expect(raw.serverTime.toISOString()).toBe("2024-01-15T10:00:01.000Z");

    const history = await getBrokerHistory(account.userId, account.id);
    expect(history?.positions).toHaveLength(1);
    expect(history?.balanceOperations.map((d) => d.ticket)).toEqual(["100"]);
  });

  it("out-of-order batches converge to the same positions as in-order ones", async () => {
    const a = await pairedConnection("order-a", "9001");
    const b = await pairedConnection("order-b", "9002");
    const deals = [buyIn("1", "1", 0), buyIn("2", "1", 1000, { volume: "2.00", price: "1.10300" }), sellOut("3", "1", 2000, { volume: "1.50" }), sellOut("4", "1", 3000, { volume: "1.50", profit: "100" })];
    await ingestHistory(await auth2(a.token), parse(historyBody(a.identity, deals)), "x", historyBody(a.identity, deals));
    for (const [i, d] of [...deals].reverse().entries()) {
      const body = historyBody(b.identity, [d]);
      await ingestHistory(await auth2(b.token), parse(body), `y${i}`, body);
    }
    const pa = await prisma.mt5Position.findFirstOrThrow({ where: { connectionId: a.connectionId } });
    const pb = await prisma.mt5Position.findFirstOrThrow({ where: { connectionId: b.connectionId } });
    for (const key of ["status", "volumeIn", "volumeOut", "avgEntryPrice", "avgExitPrice", "netProfit", "sourceHash", "flags"] as const) {
      expect(String(pb[key])).toBe(String(pa[key]));
    }
    expect(pa.flags).toEqual(expect.arrayContaining(["SCALED_IN", "PARTIALLY_CLOSED"]));
  });

  it("a re-sent ticket with different content is a conflict; the original is kept and immutable", async () => {
    const { connectionId, token, identity } = await pairedConnection("conflict");
    await historyRoute(post("/api/v1/mt5/history", historyBody(identity, [deposit("50", 0, "100.00")]), auth(token, "c1")));
    const res = await (await historyRoute(post("/api/v1/mt5/history", historyBody(identity, [deposit("50", 0, "999.00")]), auth(token, "c2")))).json();
    expect(res.conflicts).toHaveLength(1);
    const deal = await prisma.mt5Deal.findFirstOrThrow({ where: { connectionId, ticket: "50" } });
    expect(deal.profit.toString()).toBe("100");
    await expect(prisma.mt5Deal.update({ where: { id: deal.id }, data: { profit: "5" } })).rejects.toThrow(/immutable/);
  });

  it("rejects malformed records individually and reports them", async () => {
    const { connectionId, token, identity } = await pairedConnection("reject");
    const res = await (
      await historyRoute(post("/api/v1/mt5/history", historyBody(identity, [deposit("1", 0), { ticket: "2", timeMsc: 1, type: "DEAL_TYPE_BUY", volume: 1.5 }, buyIn("3", "3", 5, { entry: null })]), auth(token, "r1")))
    ).json();
    expect(res.deals.inserted).toBe(1);
    expect(res.rejected.map((r: { ticket: string }) => r.ticket)).toEqual(["2", "3"]);
    expect(await prisma.mt5Deal.count({ where: { connectionId } })).toBe(1);
  });

  it("events record live SL/TP observations; heartbeat stores snapshot and open positions", async () => {
    const { connectionId, token, identity } = await pairedConnection("events");
    await eventsRoute(post("/api/v1/mt5/events", { account: identity, deals: [buyIn("10", "10", 0, { sl: "0" })], orders: [], positionChanges: [] }, auth(token, "e1")));
    const ev = await eventsRoute(post("/api/v1/mt5/events", { account: identity, deals: [], orders: [], positionChanges: [{ positionId: "10", sl: "1.09800", tp: "0", observedAtMsc: T0 + 5000 }] }, auth(token, "e2")));
    expect(ev.status).toBe(200);
    const pos = await prisma.mt5Position.findFirstOrThrow({ where: { connectionId, positionId: "10" } });
    expect(pos.initialStopSource).toBe("NONE_AT_OPEN"); // observation never rewrites the initial stop
    expect(pos.liveStopLoss?.toString()).toBe("1.098");
    expect(await prisma.mt5PositionEvent.count({ where: { connectionId } })).toBe(1);

    const hb = await heartbeatRoute(
      post(
        "/api/v1/mt5/heartbeat",
        {
          account: identity,
          gmtOffsetSeconds: 10800,
          snapshot: { balance: "10000.00", equity: "10012.50", margin: "100.00", freeMargin: "9912.50" },
          openPositions: [{ positionId: "10", symbol: "EURUSD", type: "POSITION_TYPE_BUY", volume: "1.00", priceOpen: "1.10000", priceCurrent: "1.10125", sl: "1.09800", profit: "12.50" }],
        },
        auth(token),
      ),
    );
    const hbBody = await hb.json();
    expect(hbBody).toMatchObject({ status: "ACTIVE", backfill: { required: true } });
    const snap = await prisma.mt5AccountSnapshot.findFirstOrThrow({ where: { connectionId } });
    expect(snap.equity.toString()).toBe("10012.5");
    expect((await prisma.mt5Position.findFirstOrThrow({ where: { connectionId, positionId: "10" } })).liveOpen).toBe(true);
    expect((await prisma.mt5Connection.findUniqueOrThrow({ where: { id: connectionId } })).observedOffsetMinutes).toBe(180);

    const sym = await symbolsRoute(post("/api/v1/mt5/symbols", { account: identity, specs: [{ symbol: "EURUSD", digits: 5, contractSize: "100000", tickSize: "0.00001", tickValue: "1" }] }, auth(token)));
    expect((await sym.json()).upserted).toBe(1);
  });

  it("refuses ingestion outside the LIVE workspace scope", async () => {
    const { token, identity } = await pairedConnection("scope");
    const connection = await auth2(token);
    const body = historyBody(identity, [deposit("1", 0)]);
    await expect(runInWorkspaceScope(backtestScope("some-run"), () => ingestHistory(connection, parse(body), "s1", body))).rejects.toMatchObject({ code: "SCOPE_REFUSED" });
  });

  it("re-normalizes UTC times when the trader corrects the server-time convention, never the raw time", async () => {
    const { user, connectionId, token, identity } = await pairedConnection("tz");
    const summer = Date.parse("2024-07-15T10:00:00Z");
    await historyRoute(post("/api/v1/mt5/history", historyBody(identity, [buyIn("1", "1", summer - T0)]), auth(token, "t1")));
    const before = await prisma.mt5Deal.findFirstOrThrow({ where: { connectionId } });
    expect(before.occurredAt.toISOString()).toBe("2024-07-15T08:00:00.000Z"); // pairing default: fixed +2
    await runLive(() => setTimeConvention(user.id, connectionId, { kind: "NY_CLOSE" }));
    const after = await prisma.mt5Deal.findFirstOrThrow({ where: { connectionId } });
    expect(after.occurredAt.toISOString()).toBe("2024-07-15T07:00:00.000Z");
    expect(after.utcOffsetMinutes).toBe(180);
    expect(after.serverTime.toISOString()).toBe(before.serverTime.toISOString());
    const pos = await prisma.mt5Position.findFirstOrThrow({ where: { connectionId } });
    expect(pos.openedAt?.toISOString()).toBe("2024-07-15T07:00:00.000Z");
  });
});

// ── Stage 1 financial boundaries ───────────────────────────────────────────

describe("Stage 1 boundaries — no ledger, balance, journal or settlement effects", () => {
  it("syncing history changes no balance, ledger, trade or performance record", async () => {
    const user = await makeUser("boundary");
    const firm = await createUserPropFirm(user.id, { identityKind: "CUSTOM", customCompanyName: "MT5 Firm", marketCategory: "CFD" });
    const pfa = await createPropFirmAccount(user.id, { userPropFirmId: firm.id, displayName: "100k", marketCategory: "CFD", modelType: "TWO_PHASE", accountSize: 100_000 });
    const tradingAccountId = pfa.tradingAccountId!;
    const ledgerBefore = await prisma.accountLedgerEntry.count({ where: { accountId: pfa.id } });
    const balanceBefore = await getAccountBalance(user.id, tradingAccountId);

    const { code } = await issuePairingCode(user.id, tradingAccountId);
    const { deviceToken } = await pairMt5Terminal({ pairingCode: code, terminal: terminal("424242", "Prop-Server") }, freshIp());
    const identity = { login: "424242", server: "Prop-Server" };
    const res = await historyRoute(post("/api/v1/mt5/history", historyBody(identity, [deposit("1", 0, "100000.00"), buyIn("2", "2", 10), sellOut("3", "2", 20, { profit: "-500.00" })]), auth(deviceToken, "b1")));
    expect(res.status).toBe(200);

    expect(await prisma.accountLedgerEntry.count({ where: { accountId: pfa.id } })).toBe(ledgerBefore);
    expect(await getAccountBalance(user.id, tradingAccountId)).toBe(balanceBefore);
    expect(await prisma.trade.count({ where: { userId: user.id } })).toBe(0);
    expect(await prisma.performanceRiskSnapshot.count({ where: { userId: user.id } })).toBe(0);
    expect(await prisma.positionFill.count({ where: { userId: user.id } })).toBe(0);
    expect(await prisma.tradeAccountExecution.count({ where: { userId: user.id } })).toBe(0);
    expect(await prisma.propFirmImportedExecution.count({ where: { accountId: pfa.id } })).toBe(0);
  });
});

// ── Conflicts with the statement importer ─────────────────────────────────

describe("MT5 sync vs. Prop Firm statement import", () => {
  async function propAccount(label: string) {
    const user = await makeUser(label);
    const firm = await createUserPropFirm(user.id, { identityKind: "CUSTOM", customCompanyName: `F-${label}`, marketCategory: "CFD" });
    const pfa = await createPropFirmAccount(user.id, { userPropFirmId: firm.id, displayName: "Acct", marketCategory: "CFD", modelType: "TWO_PHASE", accountSize: 50_000 });
    return { user, pfa, tradingAccountId: pfa.tradingAccountId! };
  }

  it("blocks statement preview and confirmation while connected, with a clear explanation", async () => {
    const { user, pfa, tradingAccountId } = await propAccount("block-csv");
    const { code } = await issuePairingCode(user.id, tradingAccountId);
    await pairMt5Terminal({ pairingCode: code, terminal: terminal("31337", "S") }, freshIp());
    await expect(assertStatementImportAllowed(user.id, pfa.id)).rejects.toThrow(/connected to MT5 account 31337 @ S.*Nothing was changed/);
    const csv = Buffer.from("Time,Deal,Symbol,Type,Volume,Price,Profit\n2024.01.15 10:00:00,1,EURUSD,buy,1,1.1,0\n").toString("base64");
    const input = { accountId: pfa.id, platform: "MT5", fileName: "x.csv", fileContentBase64: csv, timezone: "UTC" } as never;
    await expect(previewImport(user.id, input)).rejects.toThrow(/blocked/);
    await expect(confirmImport(user.id, input)).rejects.toThrow(/blocked/);
    expect(await prisma.propFirmImportBatch.count({ where: { accountId: pfa.id } })).toBe(0);
  });

  it("still blocks after disconnect while broker history exists; allows it once history is deleted", async () => {
    const { user, pfa, tradingAccountId } = await propAccount("history-csv");
    const { code, connectionId } = await issuePairingCode(user.id, tradingAccountId);
    const { deviceToken } = await pairMt5Terminal({ pairingCode: code, terminal: terminal("555", "S") }, freshIp());
    await historyRoute(post("/api/v1/mt5/history", historyBody({ login: "555", server: "S" }, [deposit("1", 0)]), auth(deviceToken, "h1")));
    await revokeMt5Connection(user.id, connectionId);
    await expect(assertStatementImportAllowed(user.id, pfa.id)).rejects.toThrow(/still holds broker history/);
    await deleteMt5BrokerHistory(user.id, connectionId);
    await expect(assertStatementImportAllowed(user.id, pfa.id)).resolves.toBeUndefined();
  });

  it("refuses to pair an account that already has confirmed statement imports, without touching them", async () => {
    const { user, pfa, tradingAccountId } = await propAccount("csv-first");
    await prisma.propFirmImportBatch.create({ data: { userId: user.id, accountId: pfa.id, platform: "MT5", fileFormat: "CSV", fileName: "statement.csv", fileSizeBytes: 10, timezone: "UTC" } });
    await expect(issuePairingCode(user.id, tradingAccountId)).rejects.toMatchObject({ code: "STATEMENT_IMPORT_CONFLICT", message: expect.stringContaining("statement.csv") });
    expect(await prisma.propFirmImportBatch.count({ where: { accountId: pfa.id } })).toBe(1);
    const options = await listMt5AccountOptions(user.id);
    expect(options.find((o) => o.tradingAccountId === tradingAccountId)?.statementImportConflict?.confirmedBatches).toBe(1);
  });
});

// ── Account deletion ───────────────────────────────────────────────────────

describe("account deletion and connection cleanup", () => {
  it("soft-deleting a brokerage account revokes its connector", async () => {
    const { user, account, connectionId, token, identity } = await pairedConnection("soft-del");
    await archiveTradingAccount(user.id, account.id);
    const row = await prisma.mt5Connection.findUniqueOrThrow({ where: { id: connectionId } });
    expect(row.status).toBe("REVOKED");
    expect(row.revokedReason).toBe("Account deleted");
    const res = await historyRoute(post("/api/v1/mt5/history", historyBody(identity, []), auth(token, "z")));
    expect(res.status).toBe(401);
  });

  it("deleting a prop-firm account revokes its connector", async () => {
    const user = await makeUser("pf-del");
    const firm = await createUserPropFirm(user.id, { identityKind: "CUSTOM", customCompanyName: "Del", marketCategory: "CFD" });
    const pfa = await createPropFirmAccount(user.id, { userPropFirmId: firm.id, displayName: "Acct", marketCategory: "CFD", modelType: "TWO_PHASE", accountSize: 50_000 });
    const { code, connectionId } = await issuePairingCode(user.id, pfa.tradingAccountId!);
    await pairMt5Terminal({ pairingCode: code, terminal: terminal("246", "S") }, freshIp());
    await deletePropFirmAccount(user.id, pfa.id);
    expect((await prisma.mt5Connection.findUniqueOrThrow({ where: { id: connectionId } })).status).toBe("REVOKED");
  });

  it("hard-deleting accounts (Data Management) cascades the connection and all broker history", async () => {
    const { user, connectionId, token, identity } = await pairedConnection("hard-del");
    await historyRoute(post("/api/v1/mt5/history", historyBody(identity, [buyIn("1", "1", 0)]), auth(token, "d1")));
    expect(await prisma.mt5Deal.count({ where: { connectionId } })).toBe(1);
    await deleteDataSection(user.id, "accounts");
    expect(await prisma.mt5Connection.count({ where: { id: connectionId } })).toBe(0);
    expect(await prisma.mt5Deal.count({ where: { connectionId } })).toBe(0);
    expect(await prisma.mt5Position.count({ where: { connectionId } })).toBe(0);
  });

  it("deleting broker history requires the connection to be disconnected first", async () => {
    const { user, connectionId } = await pairedConnection("del-guard");
    await expect(deleteMt5BrokerHistory(user.id, connectionId)).rejects.toMatchObject({ code: "INVALID_STATE" });
  });
});

// helpers that use the real auth path
async function auth2(token: string) {
  return authenticateMt5Request(new Request("http://localhost", { headers: { authorization: `Bearer ${token}` } }));
}
function parse(body: ReturnType<typeof historyBody>) {
  return { ...body, kind: "BACKFILL" as const, isFinal: Boolean(body.isFinal), deals: body.deals as unknown[], orders: [] as unknown[] };
}
