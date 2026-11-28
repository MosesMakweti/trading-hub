# MT5 Connector — Stage 1 (read-only account-history sync)

Traditorium's first-class MetaTrader 5 integration. A read-only MQL5 Expert
Advisor (`extensions/mt5/TraditoriumConnector.mq5`) running in the trader's
Windows MT5 desktop terminal sends the account's deals, orders, open positions
and account snapshots to Traditorium. Traditorium stores the raw broker records
and derives positions from them, shown on the account's **Broker History**
page.

> **Status:** implemented and covered by automated tests against PostgreSQL.
> **Not yet verified against a real MT5 terminal** — the EA has not been
> compiled in MetaEditor or run on a demo account in this environment (no
> Windows/MT5 here). See "Manual verification" below before relying on it.

## Stage 1 boundaries

| Area | Stage 1 behaviour |
|---|---|
| Journal | Never creates, links or edits a journal `Trade`. Broker history is account-side only. Linking is Stage 2. |
| Ledger / balances | Never posts to `AccountLedgerEntry`; `getAccountBalance` and prop-firm ledger balances are unchanged. Broker-derived balances are Stage 2. |
| Settlement | Never touches `PerformanceRiskSnapshot`, `PositionFill`, settled performance records or `Trade.actualRR`. |
| Analytics | Canonical (R-based) and prop-firm analytics are unchanged; broker positions are not part of them. |
| Candle imports | Entirely separate from `MarketDataImport` / `HistoricalDataset` (MT5 *candle* imports). No shared tables or services. |
| Workspace | LIVE only. Routes run in `runLive` + scope tripwire; services refuse any other scope (`SCOPE_REFUSED`). |

These are asserted by `src/server/services/mt5-connector.integration.test.ts`
("Stage 1 boundaries").

## Architecture

```
MT5 terminal ── TraditoriumConnector.mq5 (read-only)
   OnTradeTransaction → in-memory queue (no I/O)
   OnTimer (2s)       → pair | heartbeat | live events | backfill | reconcile
        │  HTTPS WebRequest, Bearer td_mt5_…, Idempotency-Key, ≤ 450 records/request
        ▼
/api/v1/mt5/{pair,heartbeat,history,events,symbols}
   runLive + tripwire · Zod · 2 MB body cap · per-connection advisory lock
        ▼
RAW (immutable)   Mt5Deal, Mt5Order            ← first copy wins (DB trigger)
LIVE observations Mt5AccountSnapshot, Mt5PositionEvent, Mt5Position.live*
DERIVED           Mt5Position (per DEAL_POSITION_ID, versioned, sourceHash)
        ▼
Settings → Integrations (connect / status)   /accounts/[id]/broker-history (read-only)
```

- **Anchor:** `Mt5Connection.tradingAccountId` (unique) → `TradingAccount`. Works
  for prop-firm accounts (via their paired `TradingAccount`) and brokerage
  accounts. The virtual Performance Account can't be connected.
- **Position reconstruction** (`src/domain/mt5-account/position-derivation.ts`)
  groups deals **only** by `DEAL_POSITION_ID` (never symbol/direction), so
  hedging accounts with several positions per symbol are correct. Handles
  IN / OUT / INOUT (netting reversal under the same id) / OUT_BY (close-by),
  scale-ins, partial closes, commissions, swaps and fees. Deterministic:
  sorted by time then ticket; re-derived only for positions a batch touched,
  from all of that position's stored deals, so out-of-order batches converge.
  Unchanged inputs (same `sourceHash` + `derivationVersion`) are not rewritten.
- **Unknowns stay unknown:** missing opening deals → `INCOMPLETE_HISTORY`, null
  entry price. Initial SL comes only from the opening deal (`DEAL_SL`) or the
  opening order (`ORDER_SL`); otherwise `NONE_AT_OPEN` (explicit 0) or
  `UNAVAILABLE`. MT5 keeps no history of SL modifications; live changes are
  recorded as observations (`Mt5PositionEvent`) and never rewrite the initial
  stop. No R values are computed in Stage 1.

### Server time

MT5 reports times in the broker **server's wall clock**, not UTC. Every row
keeps the raw value (`timeMsc`, `serverTime`) and a derived `occurredAt` plus
the `utcOffsetMinutes` used. The connection's `timeConventionJson` is one of:

- `FIXED_OFFSET` — pairing default, from the offset the terminal reported
  (`TimeTradeServer() − TimeGMT()`, rounded to 15 min). Exact only for brokers
  without daylight saving.
- `NY_CLOSE` — GMT+2/+3 on US DST dates (most retail FX brokers).
- `IANA_ZONE` — any zone, e.g. `Europe/Athens`.

The trader can change it on the Broker History page; this re-normalizes
`occurredAt` / order and position UTC times from the untouched raw times (the
immutability trigger permits exactly those columns to change). The integrations
card warns when the terminal's current offset differs from a fixed convention.

## Data model (migration `20261128120000_mt5_connector_foundation`)

Additive only: 9 enums, 9 tables, indexes, FKs, a CHECK constraint and an
immutability trigger. No existing table is altered.

| Model | Purpose | Key constraints |
|---|---|---|
| `Mt5Connection` | login/server identity, account type, margin mode, pairing-code HMAC + expiry, device-token sha256, sync progress, time convention | `tradingAccountId` unique; `(userId, server, login)` unique; CHECK: token hash only while ACTIVE/PAUSED |
| `Mt5SyncBatch` | one accepted ingest request; stored response for replay | `(connectionId, idempotencyKey)` unique |
| `Mt5Deal` | raw deal; tickets as strings; Decimal money/prices; BigInt ms | `(connectionId, ticket)` unique; immutable except UTC columns |
| `Mt5Order` | raw history order | `(connectionId, ticket)` unique; immutable except UTC columns |
| `Mt5Position` | derived position + live observation columns | `(connectionId, positionId)` unique |
| `Mt5PositionEvent` | live SL/TP observation | `(connectionId, positionId, observedMsc)` unique |
| `Mt5AccountSnapshot` | balance/equity/margin + open positions (≥ 60 s apart) | index `(connectionId, capturedAt)` |
| `Mt5SymbolSpec` | broker symbol spec (informational) | `(connectionId, symbol)` unique |
| `Mt5PairingAttempt` | DB-backed pairing rate limit (hashed IP) | pruned lazily after 24 h |

Deletion: hard-deleting a `User` or `TradingAccount` (e.g. Data Management →
Accounts) cascades the connection and all broker history. Soft-deleting an
account (`archiveTradingAccount`, `deletePropFirmAccount`) **revokes** the
connection; its history stays with the soft-deleted account.

## Security

- **No MT5 passwords.** Nothing requests, accepts or stores a master or investor
  password. The EA runs inside the logged-in terminal.
- **Pairing code:** 8 chars from an unambiguous alphabet (~40 bits), 10-minute
  expiry, single use (conditional update — concurrent use yields one token),
  stored as HMAC-SHA256 keyed with `AUTH_SECRET` (or `MT5_PAIRING_SECRET`).
  Failed attempts are limited to 10 per hashed client IP per 15 minutes (429).
- **Device token:** `td_mt5_` + 256 random bits, returned once, stored as
  sha256. Bound to one connection, MT5 login and server — every request must
  carry the same `account.login`/`account.server` (403 `ACCOUNT_MISMATCH`).
- **Isolation:** `verifyApiToken` only accepts `td_live_`, so MT5 tokens can't
  call `/api/v1/trades|strategies|media|me`; MT5 routes only accept `td_mt5_`.
  MT5 tokens can only ingest into their own connection.
- **Revocation** destroys the token hash (DB CHECK enforces it). Pause keeps the
  token but refuses ingestion (409 `PAUSED`); heartbeats still answer `PAUSED`.
- **Transport:** the EA refuses non-HTTPS URLs except `http://localhost` /
  `http://127.0.0.1`. No CORS headers are sent by the MT5 routes.
- **Token at rest on the PC:** stored in `MQL5\Files\Traditorium\conn_<login>_<server>.txt`
  inside the terminal's data folder (per Windows user). Anyone with access to
  that folder can use the token for ingest-only calls; revoke it from
  Settings → Integrations if a PC is compromised.

## API (all `POST`, JSON, `runtime = "nodejs"`)

Errors: `{ "error": string, "code": string, "issues"?: [{ path, message }] }`.
Tickets, logins and decimals are strings; times are MT5 server milliseconds
(number or digit string); MQL5 enums are sent by name (`DEAL_TYPE_BUY`).

| Route | Auth | Request | Response |
|---|---|---|---|
| `/api/v1/mt5/pair` | none (rate-limited) | `{ pairingCode, terminal: { login, server, company?, currency, currencyDigits?, leverage?, marginMode: HEDGING\|NETTING\|EXCHANGE, tradeMode: DEMO\|CONTEST\|REAL, build?, eaVersion, gmtOffsetSeconds } }` | `201 { connectionId, deviceToken, tokenPrefix, account, timeConvention, config }` · 410 invalid/expired/used · 409 `ALREADY_CONNECTED` / `IDENTITY_MISMATCH` / `STATEMENT_IMPORT_CONFLICT` · 429 |
| `/api/v1/mt5/heartbeat` | Bearer | `{ account, eaVersion?, build?, gmtOffsetSeconds?, serverTimeMsc?, snapshot: { balance, equity, margin, freeMargin, credit?, profit? }, openPositions: [...] }` | `200 { status: ACTIVE\|PAUSED, backfill: { required, completedAt }, cursor, config }` |
| `/api/v1/mt5/history` | Bearer + `Idempotency-Key` | `{ account, kind: BACKFILL\|RECONCILE, isFinal, batchSeq?, rangeFromMsc?, rangeToMsc?, deals: [≤500], orders: [≤500] }` | `200 { replayed, batchId, deals: {received, inserted, duplicates}, orders: {...}, positionsRederived, conflicts, rejected, cursor, backfill }` · 409 key reused with a different body / `PAUSED` · 413 · 422 |
| `/api/v1/mt5/events` | Bearer + `Idempotency-Key` | `{ account, deals, orders, positionChanges: [{ positionId, sl, tp, observedAtMsc }] }` | same as history |
| `/api/v1/mt5/symbols` | Bearer | `{ account, specs: [{ symbol, digits?, contractSize?, tickSize?, tickValue?, volumeMin?, volumeMax?, volumeStep?, currency* }] }` | `200 { upserted }` |

Individual malformed records are **rejected and reported** (`rejected[]`,
also shown on the Broker History page) instead of failing the whole batch; a
re-sent ticket with different content is reported in `conflicts[]` and the
original record is kept.

## Conflicts with the Prop Firm statement importer

The same history must not reach an account twice:

- Pairing is refused (`STATEMENT_IMPORT_CONFLICT`) while the account has
  confirmed (not rolled-back) statement imports. Nothing is deleted.
- Statement import preview **and** confirmation are refused while the account
  has a non-revoked MT5 connection, or still holds MT5 broker history from an
  earlier one. The message explains how to switch. Nothing is deleted.
- Broker history is removed only by the explicit "Delete broker history"
  action (allowed only after disconnecting) or by hard-deleting the account.

## The Expert Advisor

`extensions/mt5/TraditoriumConnector.mq5` — strictly read-only (no `OrderSend`,
`CTrade`, `PositionClose` or any order/position modification; enforced by
`src/lib/validation/mt5-connector-ea.test.ts`).

- Identifies the logged-in account (`ACCOUNT_LOGIN`, `ACCOUNT_SERVER`); keeps
  separate state per login + server and switches when the terminal's account
  changes.
- Pairs with the code from its inputs and stores the device token.
- **Backfill:** `HistorySelect(0, now)`; sends all deals, then all history
  orders, in time order, in batches (default 200, ≤ 450), never splitting a
  millisecond so the time cursor is exact; the last orders batch is `isFinal`.
- **Live:** `OnTradeTransaction` only queues deal tickets (`DEAL_ADD`), history
  orders (`HISTORY_ADD`) and position SL/TP changes (`POSITION`). `OnTimer`
  sends them; an unacknowledged events payload is re-sent verbatim with the
  same key.
- **Heartbeat** every 60 s: account snapshot + open positions; learns
  `PAUSED` and whether the server wants a (re-)backfill.
- **Reconcile** every 15 min and after restarts: re-sends the last hour before
  the newest acknowledged deal onward; the server skips duplicates. Covers
  missed live events (terminal closed, queue overflow, network failure).
- **Checkpoints** persist in `MQL5\Files\Traditorium\conn_<login>_<server>.txt`.
- **Failures:** exponential backoff (5 s → 5 min); 413/422 halves the batch
  size; 401 clears the token and asks for a new pairing code; 403 stops; 409
  `PAUSED` waits.
- Refuses to run in the Strategy Tester (WebRequest is unavailable there).

### Compile and install (Windows)

1. MetaTrader 5: **File → Open Data Folder**, copy `TraditoriumConnector.mq5`
   into `MQL5\Experts\`.
2. Open it in MetaEditor (F4 from MT5) and press **F7 (Compile)** — expect
   `0 errors`. Or from a command prompt:
   `"C:\Program Files\MetaTrader 5\MetaEditor64.exe" /compile:"<DataFolder>\MQL5\Experts\TraditoriumConnector.mq5" /log`
   (the result is written to `TraditoriumConnector.log` next to the source).
3. **Tools → Options → Expert Advisors:** tick *Allow WebRequest for listed URL*
   and add the Traditorium origin exactly (e.g. `https://app.example.com`).
4. Traditorium: **Settings → Integrations → MetaTrader 5 Connector →
   Generate pairing code** for the account.
5. Drag the EA onto any chart, set `InpServerUrl` and `InpPairingCode`. Algo
   Trading does not need to be enabled.

### Manual verification on a demo account (required before calling it done)

1. Compile with 0 errors/warnings that matter; attach to a **demo** account.
2. Confirm the chart comment reaches "Paired — importing history" then
   "History imported"; compare deal/order counts with MT5's History tab.
3. Open, partially close, modify SL/TP and close a position; confirm Broker
   History shows the deals, live SL/TP and the closed position.
4. On a hedging demo: open two positions on one symbol; on a netting demo:
   reverse a position — check the derived rows.
5. Restart the terminal mid-backfill and with the network unplugged; confirm
   the sync resumes without duplicates.
6. Pause / resume / disconnect from Traditorium and confirm the EA reacts.
7. Check the server-time setting against a known deal time.

## Tests

- `src/domain/mt5-account/*.test.ts` — classification, decimals, server time,
  and position reconstruction (netting, hedging, scale-in, partials, INOUT,
  OUT_BY, commissions/swaps/fees, incomplete history, determinism).
- `src/server/services/mt5-connector.integration.test.ts` — DB-backed: pairing
  (expiry, single use, races, rate limit, identity), token isolation,
  revocation, login/server mismatch, pause, idempotency, duplicates,
  out-of-order batches, conflicts, rejections, events/heartbeat/symbols,
  BACKTEST refusal, time re-normalization, Stage 1 boundaries, statement-import
  conflicts, account deletion cleanup.
- `src/lib/validation/mt5-connector-ea.test.ts` — static read-only and
  wire-format checks of the EA source.

## Known limitations (Stage 1)

- Not yet verified against a real MT5 terminal (see above).
- No distribution channel for the `.mq5` file yet (copied manually).
- History depth is whatever the broker serves to `HistorySelect`; the UI shows
  the range actually received.
- `FIXED_OFFSET` default is wrong across DST for DST-observing brokers until the
  trader picks `NY_CLOSE`/a zone.
- Snapshots accumulate (≤ 1/min while the terminal runs); no retention policy yet.
- Time-convention re-normalization updates rows one by one inside a 120 s
  transaction — very large histories may need batching.
- Stage 2: journal linking, broker-derived balances / ledger projection.
