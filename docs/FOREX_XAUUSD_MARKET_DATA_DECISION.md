# Forex / XAUUSD Market-Data Provider Decision (Stage 17C.1)

> **Stage 17D correction (read this first):** this document's §13/§15
> recommended `priceBasis: "MID"` for Twelve Data's V1 adapter, reasoning
> that Twelve Data's own "mid-price" wording (documented for its WebSocket
> feed) likely also describes its REST `/time_series` historical endpoint.
> Stage 17D's production-acceptance audit determined that inference wasn't
> strong enough to justify a persisted, user-facing factual claim — the
> implementation (`twelve-data-provider.ts`) now uses
> `priceBasis: "AGGREGATED"` instead, which was already listed as a
> candidate value in this doc's own §13 closed set and asserts only what's
> actually confirmed. Every `MID` reference below is preserved as the
> original point-in-time research/recommendation record — see
> `docs/TWELVE_DATA_MARKET_DATA.md`'s "Price basis" section for the current,
> corrected behavior and the full reasoning.

**Research/architecture only — no provider integrated, no code changed.**
Research conducted September 2026 via each provider's own current developer
docs, pricing pages, and terms-of-service/license documents (cited inline).
Stage 17B/17B.1 solved the futures side with Databento (exchange-listed,
single authoritative contract per symbol). This stage exists because Forex
and spot gold are structurally different: **no OTC instrument has one
globally authoritative candle series**, so the architecture has to represent
that honestly rather than pretend otherwise.

## 1. The core problem, stated precisely

`EURUSD`, `XAUUSD`, etc. are not exchange-listed. Every vendor's candle for
"EURUSD" is that vendor's own construction — some blend of liquidity-provider
quotes, a broker's own dealt price, or an aggregate across many sources —
and different vendors' 1-minute bars for the same pair at the same minute
will disagree, sometimes materially around news/thin-liquidity periods. A
trader's own broker (MT4/MT5/prop-firm platform) is yet another, different
construction. **Traditorium Replay must label its OTC price series by its
actual source and basis, never imply "the" historical price exists.** This
principle governs every recommendation below.

## 2. Providers investigated

OANDA, Twelve Data, Massive (formerly Polygon.io, rebranded 2026-10-30 — same
platform/team), Tiingo, dxFeed. All five have current, live developer
documentation; findings below are grounded in that documentation, not
inference from marketing copy. Every claim below traces to a citation; a
genuinely undocumented point is marked **UNKNOWN** rather than guessed —
this stage will not repeat Stage 17B's "documentation couldn't be verified,
so guess defensively" mistake (Stage 17B.1 corrected that guessing
explicitly; this stage doesn't reintroduce it in a new form).

---

## 3. Forex source semantics — what a "candle" actually means, per provider

| Provider | Forex price basis | Source |
|---|---|---|
| OANDA | **Broker-quoted** — OANDA is itself a market-maker (fxTrade); BID/ASK/MID are OANDA's own dealt prices, not an independent interbank reference | [Instrument Endpoints](https://developer.oanda.com/rest-live-v20/instrument-ep) |
| Twelve Data | **Aggregated MID** across 60+ named liquidity sources (BNP Paribas, Commerzbank, ECB, SAXO, UBS, XE) — mid-price only, no bid/ask series | [Forex API v2](https://support.twelvedata.com/en/articles/12520817-forex-api-v2) |
| Massive | UNKNOWN — "Candlestick Bars" (OHLCV) documented, basis never stated | [massive.com/currencies](https://massive.com/currencies) |
| Tiingo | Described only as "aggregated bid/ask feed" but delivered as O/H/L/**Last** fields, not explicit Bid/Ask/Mid — exact basis UNKNOWN beyond "aggregated" | [Forex API](https://www.tiingo.com/products/forex-api) |
| dxFeed | UNKNOWN — not disclosed on public pages | [dxfeed.com](https://dxfeed.com/) |

## 4. XAUUSD source semantics

| Provider | XAUUSD basis | Notes |
|---|---|---|
| OANDA | Same broker-quoted BID/ASK/MID pattern as FX | [Instrument specs](https://www.oanda.com/eu-en/instruments-specification) |
| Twelve Data | Same weighted-average aggregate treatment as FX, not futures-derived (no separate methodology documented) | [Forex API v2](https://support.twelvedata.com/en/articles/12520817-forex-api-v2), [Commodities](https://twelvedata.com/commodities) |
| Massive | UNKNOWN which product (Indices/Commodities) actually carries it | — |
| Tiingo | Delivered through the Forex endpoints alongside silver/platinum; basis UNKNOWN beyond "aggregated" | [Forex API](https://www.tiingo.com/products/forex-api) |
| dxFeed | UNKNOWN | — |

**No provider researched treats spot XAUUSD as futures-derived (i.e.,
COMEX GC-backed).** All that documented anything treat it as an OTC-style
aggregate/broker-quoted instrument, structurally identical to a forex pair.
This matters for §14 (mismatch expectations).

---

## 5. OANDA — findings

- **BID/ASK/MID:** all three available historically via `price=B|A|M`
  (combinable, e.g. `price=BAM`) on `GET /v3/instruments/{instrument}/candles`,
  down to `M1` granularity. Max 5000 candles/request.
- **XAU_USD:** supported, same broker-quoted basis as FX.
- **Index CFDs** (SPX500_USD, NAS100_USD, etc.): offered, but these are
  OANDA's own synthetic CFD construction on the index — not the underlying
  futures market. Same broker-derived-price caveat as FX applies.
- **Demo vs. live:** full API access on a free demo account, same rate
  limits as live.
- **Rate limits:** 120 req/s (REST) — generous.
- **Pricing:** API access bundled free with a demo or live account; no
  separate paid data-API SKU found.
- **Licensing — decisive finding:** OANDA's **API License Agreement (Feb
  2023)** explicitly **prohibits redistributing, or providing access to,
  Licensed Material to any third party** — including a licensee's own
  customers — without OANDA's prior written permission; it separately bars
  reselling or "otherwise mak[ing] available" the data, including
  re-transmission to other premises. The general Terms of Use additionally
  restrict use to "personal and non-commercial." No caching carve-out was
  found; the redistribution restriction is broad enough to cover stored
  copies too. Sources: [API License Agreement, Feb 2023 (PDF)](https://docs.oanda.com/6817bbf2-068b-4000-bc1c-86b13d60b2de/API_License_Agreement_-_February_2023.pdf), [Terms of Use Agreement (PDF)](https://www.oanda.com/assets/documents/425/OANDA_Terms_of_Use_Agreement.pdf).

**Verdict:** technically the best fit (true BID/ASK/MID, broker-quoted, free,
generous limits) — but **licensing-blocked** for Traditorium's exact
shape (one credential, many authenticated SaaS end-users) without a bespoke
written agreement OANDA does not appear to offer self-serve.

## 6. Twelve Data — findings

- **Forex/XAUUSD:** MID-only, aggregated across 60+ liquidity sources (see
  §3/§4). No bid/ask series exists at any tier.
- **1m depth:** ~1 year of 1-minute intraday history (exact per-symbol start
  via `/earliest_timestamp`).
- **Coverage:** XAUUSD/XAGUSD confirmed; indices available via a separate
  Indices product.
- **External display rights:** Individual plans (Basic→Ultra, $0–$329/mo)
  are internal-use-only by explicit ToS language. Commercial display to
  Traditorium's own end-users requires the **Business** tier: **Venture**
  ($414/mo or $4,990/yr) grants "external display data access"; **Enterprise**
  ($916/mo or $10,992/yr) adds "external distribution"; **Enterprise+**
  (custom) adds white-labeling. Sources: [Business pricing](https://twelvedata.com/pricing-business), [Commercial vs personal usage](https://support.twelvedata.com/en/articles/5332349-commercial-and-personal-usage).
- **Caching/storage rights:** ToS §2.3(g) prohibits caching "beyond
  permitted timeframes" (exact numeric limit deferred to per-plan docs, not
  located); §16.1–16.2: retention permitted only for the subscription's
  duration, and **all data must be deleted within 30 days of subscription
  termination** — caching is allowed while paying, not a perpetual archive
  right. Source: [Terms of use](https://twelvedata.com/terms).
- **Rate limits:** Venture = 610 req/min, no stated daily cap — comfortably
  enough for a low-hundreds-of-users weekly/monthly Replay workload.
- **Pricing:** Venture ($414/mo) is the minimum tier satisfying both
  external display and adequate rate limits; the exact "external display"
  vs. "external distribution" boundary (Venture vs. Enterprise) isn't
  spelled out precisely enough to be 100% certain Venture alone suffices —
  flagged as a pre-integration confirm-with-sales item, not a blocker.

**Verdict:** the only provider researched with a **self-serve, publicly
priced, explicitly-worded commercial redistribution tier**. No BID/ASK, but
that's an acceptable V1 tradeoff (see §11/§13).

## 7. Massive (formerly Polygon.io) — findings

- Separate products for Currencies (forex) and Indices; gold/XAUUSD's exact
  product placement UNKNOWN.
- Price basis UNKNOWN — OHLCV described, no bid/ask/mid/aggregate
  methodology documented.
- 1m depth: Free = 2 years; Starter ($49/mo) = 10+ years.
- **Individual/Starter tiers are explicitly "individual use only"** — the
  Market Data ToS prohibits redistributing, displaying, or disseminating
  data, and bars "an application intended for use by end users other than
  you"; data must be deleted on termination. A separate **Business** ToS
  defines "Edge Users" (a SaaS product's own end-users) as a permitted
  display category, but only via a **custom, sales-negotiated Order Form —
  no public pricing**. Sources: [Market Data ToS](https://massive.com/legal/market-data-terms-of-service), [Businesses ToS](https://massive.com/legal/businesses-terms-of-service).

**Verdict:** structurally similar to Twelve Data's tiering (individual vs.
business), but the business tier isn't self-serve/transparently priced —
worse fit than Twelve Data for a startup that wants a clear, quotable price
before committing engineering time.

## 8. Additional candidates researched (Tiingo, dxFeed)

- **Tiingo:** 140+ FX pairs, 1m bars to ~Jan 2020, XAUUSD/XAGUSD folded into
  the Forex endpoints. Even the paid **Commercial tier ($50/mo)** is
  internal-use-only by ToS — displaying to Traditorium's own users requires
  a separate, sales-negotiated redistribution license with **undisclosed
  pricing**. Source: [ToS](https://app.tiingo.com/tos/).
- **dxFeed:** institutional/B2B positioning (brokerages, prop firms,
  exchanges), no public pricing, sales-only engagement. Its B2B2C framing
  *suggests* redistribution-to-end-users is a supported product shape, but
  this is inferred from positioning, not confirmed contract language —
  realistically not self-serve-accessible for a small SaaS startup right
  now. Source: [dxfeed.com](https://dxfeed.com/).

Neither changes the ranking below — both land in the same "sales-negotiated,
opaque pricing" bucket as Massive's Business tier, one rung below Twelve
Data's self-serve Venture tier.

---

## 9. Generic vs. broker-specific market data (Option A/B/C evaluation)

**Option A — generic provider feed only.** Simple, scalable, one integration,
consistent across all users. Weakness: won't exactly match any individual
trader's broker chart.

**Option B — broker-specific feed.** Higher fidelity in principle, but: prop
firms route through varying/undisclosed liquidity providers with no public
historical API; MT4/MT5 brokers rarely expose a historical REST API to
non-account-holders; even where one exists (see OANDA above), it's typically
licensed for the account holder's own use, not third-party SaaS
redistribution to *other* people's accounts. This option is not really
buildable in general — it only works for the subset of brokers that (a)
have a documented historical API and (b) license redistribution, which per
this research is close to zero without direct commercial negotiation.

**Option C — hybrid: generic default, broker-specific as a future optional
upgrade.** This is the correct architecture, and the justification is
concrete rather than assumed: Option A alone is buildable *today* with a
provider that already grants the needed rights (Twelve Data); Option B is
provably not broadly buildable given every broker/vendor researched either
lacks a public historical API or prohibits redistribution outright (OANDA
included). A hybrid keeps the door open — per-account or per-trade source
override — without blocking on something that isn't available. **Recommendation:
Option C (hybrid), with Option A as the only thing actually built in
17C.2.**

## 10. `MarketDataSource` concept — where it belongs

A formal `MarketDataSource` concept is worth introducing, but **not as a new
persisted model yet** (see prior art below). It belongs conceptually at
**the resolution-function level, not a database table** — exactly how
Stage 17B's `resolveMarketDataProvider(canonicalSymbol)` already works for
futures. For OTC instruments the same function needs one more input: the
account (if any) a Replay session/trade is associated with, so a *future*
per-account override has somewhere to plug in (§8/§9 below) without a schema
change today.

**Prior art directly on point:** `PropFirmAccount` once had free-text
`platform`/`dataFeed` columns, deliberately dropped in migration
`20260828231344_remove_prop_firm_account_platform_datafeed` because "no live
broker/MT5 connection ever existed behind them." That is exactly the trap
this stage must not repeat: don't add `TradingAccount.marketDataSource` (or
any broker/platform snapshot field) until a real consumer exists that reads
it. The extension point is the *function signature*
(`resolveMarketDataProvider(canonicalSymbol, account?)`), not a column.

## 11. `TradingAccount` relationship

**Leave an extension point, do not build it now.** Concretely: when 17C.2's
provider-selection function is written, give it an optional account
parameter from day one (even though nothing populates a per-account
override yet) so a future `TradingAccount.preferredMarketDataSource` (or
similar) can be read without re-threading the call chain through
`replay-review.service.ts` → `market-data.service.ts` → UI. This costs
nothing today and avoids the exact `platform`/`dataFeed` mistake above by
not adding the column until something concrete uses it.

## 12. Trade-level source snapshot

**Not necessary now, and probably never as a *broker* snapshot** given no
researched provider can honor a broker-specific request anyway (§9 Option
B). What IS worth keeping is what Traditorium already keeps: the trader's
raw, unmodified `Trade.assetSymbol`/broker-displayed symbol text (see §19) —
that's sufficient input for a future account-level source preference without
inventing new per-trade broker metadata that would sit unused, repeating the
`platform`/`dataFeed` pattern a third time.

---

## 13. Price basis — recommendation

The existing `CandleProvenance.priceBasis` string field (Stage 17B) is
**sufficient as a data shape** — it already carries an informational,
never-used-for-math label (`"raw-unadjusted"`, `"synthetic"`). For OTC data
it should carry one of a small closed set of values:

`MID | BID | ASK | AGGREGATED | BROKER_QUOTED | INDICATIVE`

(`TRADE` is dropped from the candidate list — no researched OTC provider
offers an actual last-traded-print series distinct from a quote-derived
series; keep the enum to values something in this research actually
supports.)

**Recommendation for what Replay itself uses:**
- **Chart display → MID/aggregated** (whatever the provider's single series
  is called — Twelve Data's is explicitly `MID`/aggregated).
- **Execution simulation (V1) → the SAME single series**, not a
  spread-split BID/ASK. See §14 — this is a deliberate V1 simplification,
  not an oversight.

This directly answers "is `priceBasis` sufficient?": **yes for V1**, because
V1 only ever populates it with one value per session (no per-order-side
basis switching yet). It becomes insufficient only once/if V2 BID/ASK
execution is built (§25) — at that point `CandleProvenance` needs to be able
to describe *two* concurrently-fetched series, which is a real (but small)
extension, not a redesign.

## 14. The spread problem — evaluation

**A. Ignore spread (single OHLC series).** Simplest, what V1 futures
execution already effectively does (no bid/ask concept for exchange-listed
futures priced at last/mid). Risk: a trade with a genuinely tight stop can
show a discrepancy Replay can't explain ("your stop wasn't actually hit in
our data, but it was on your broker").

**B. Model a fixed/estimated spread.** Middle ground — apply a configured or
historically-typical spread constant to widen the effective fill zone around
MID. Cheap to build, but introduces a *fabricated* number Traditorium didn't
actually observe, which cuts against this stage's "never pretend a single
authoritative price" principle in a subtler way (now it's pretending a
single authoritative *spread*).

**C. Fetch BID and ASK separately.** Most faithful — only OANDA offers this
among researched providers, and OANDA is licensing-blocked for V1 (§5).

**Recommendation: A for V1** (ignore spread, single MID series, clearly
labeled), **C as the defined V2 upgrade path if/when a BID/ASK-capable,
redistribution-licensed provider becomes available** (either OANDA via a
negotiated agreement, or a future provider). B is explicitly not
recommended at any stage — a fabricated spread constant is worse than either
extreme: it looks precise without being real.

## 15. Recommended Replay execution semantics — V1 vs V2

**V1 (recommended, build in 17C.2): MID-only OHLC execution, clearly labeled
approximate.** Justification tied directly to Traditorium's actual purpose
(§26): Replay answers "what should I have done," a behavioral/process
question, not "did my broker fill me at 1.08453 or 1.08455." A single-digit-
pip discrepancy on an already-approximate reconstruction doesn't change
whether a trade followed the trader's plan. Building BID/ASK V2 first would
spend real engineering effort (dual-series fetch/cache/provenance, spread-
aware fill logic) on precision the product's own review purpose doesn't
need yet, and no self-serve/licensed-for-redistribution provider offers it
today anyway (§5/§14).

**V2 (future, gated on both a real need signal AND provider availability):**
BID/ASK candles, BUY fills at ASK, SELL fills at BID, stop/exit logic
mirrored per side. Build this only if either (a) OANDA (or an equivalent)
becomes available under a negotiated redistribution agreement, or (b) users
report V1's MID-only approximation is materially misleading around specific
tight-stop scenarios — not preemptively.

## 16. XAUUSD-specific expectations

No researched provider sources XAUUSD from COMEX futures (GC/MGC) — all are
OTC-style aggregates or broker-quoted, structurally identical to a forex
pair (§4). Expected mismatch vs. a trader's actual MT5/prop-firm broker
chart:
- **Session gaps:** a trader's broker may show a different weekend/rollover
  gap boundary than Twelve Data's aggregate — both are "real" in the sense
  that OTC gold trades near-continuously with no single canonical session
  close.
- **Minor price disagreement, especially during low-liquidity windows**
  (Asian session, pre-London) and around news, where broker-specific
  markups diverge most.
- **Decimal precision:** the instrument catalog already carries XAUUSD at
  `decimalPrecision: 2` — expected to match Twelve Data's typical two-decimal
  quoting; minimum price increment is not independently verified per-provider
  and should be confirmed against actual returned data in 17C.2, not assumed.

**UI recommendation:** treat XAUUSD identically to any forex pair in the
disclosure language (§17) — it does not need special-cased wording beyond
"this is an OTC/aggregated price, not futures-derived and not your broker's
own feed."

## 17. Product-honesty UI wording — recommendation

- **Source badge** (small, non-alarming, next to the existing Databento/
  Fixture source label already shown in Replay — see `buildSourceLabel` in
  `replay.actions.ts`): `"Data: Twelve Data (MID)"` — mirrors the existing
  `"Data: Databento · ESZ6"` / `"Data: Synthetic Fixture"` pattern exactly,
  no new UI mechanism needed.
- **Tooltip on that badge:** *"Forex/XAUUSD prices are an aggregated
  mid-market reconstruction, not your broker's exact feed — expect minor
  differences, especially on tight stops."*
- **Replay settings / help text (once, not per-session):** a short
  explainer distinguishing exchange-listed futures (Databento — literal
  contract data) from OTC forex/metals (aggregated reconstruction),
  consistent with the honesty principle in §1.
- **No comparison disclaimer needed beyond the badge/tooltip** — Stage 15.2's
  Actual-vs-Replay comparison already operates in R-multiples, which
  absorbs small OTC price disagreement without needing a separate warning
  layer.

## 18. Market-data provenance additions for OTC instruments

Minimal, reusing the existing `CandleProvenance` shape (Stage 17B) rather
than inventing a parallel structure:

- `providerId` — existing field, e.g. `"twelvedata"`.
- `datasetId` — existing field, optional; likely unused for OTC (no
  Databento-style named dataset) or set to a fixed provider constant.
- `priceBasis` — existing field, populated from the closed set in §13
  (`"MID"` for the V1 recommendation).
- `retrievedAt` — existing field, unchanged semantics.
- `segments` — existing field; for OTC there is no literal-contract concept,
  so a single segment spanning the fetched range (no rollover) is
  sufficient — mirrors how `FixtureMarketDataProvider` already populates it.

**Explicitly NOT adding:** `brokerSpecific`, `sourceBroker`,
`aggregationSource`, `sessionConvention` fields speculatively. None of them
have a concrete producer or consumer yet (no broker-specific source exists
to set `sourceBroker`; no per-provider session-convention divergence has
been observed, only hypothesized in §16). Add them only when a real feature
needs to read them — same discipline as §10/§11's schema-avoidance
reasoning.

## 19. Provider consistency (freeze-once) — confirmed unchanged

**Stage 17B.1's policy holds without modification for OTC providers.** A
Replay session that starts on Twelve Data for XAUUSD stays on Twelve Data
for that asset's remaining life in that session; if Twelve Data access later
disappears (subscription lapse, key revoked), the session returns a clear
`PROVIDER_ERROR`, never silently substituting OANDA or Fixture. If
`isProviderDisplayPermitted` is later disabled for the OTC provider (mirror
of the existing Databento licensing kill-switch), the same
`PROVIDER_DISPLAY_DISABLED` structured state applies, preserving frozen
provenance. No new policy needed — `replay-review.service.ts`'s existing
`fetchReplayCandlesWithProvenance` mechanism already generalizes to a second
provider id with zero conceptual change, only a second entry in
`getProviderById`/`resolveMarketDataProvider`'s provider set.

## 20. Provider/account selection hierarchy (future design, not built now)

```
1. Replay session's frozen provenance for this asset (if one exists)
2. Account-specific source preference, IF a TradingAccount-level override
   exists (does not exist today — see §11's extension point)
3. Application default source for the asset's class:
     FUTURES  -> Databento (Stage 17B/17B.1)
     FOREX/METALS/OTC-INDEX -> Twelve Data (this stage's recommendation)
4. Fixture — development/no-key/no-license fallback only, never reached in
   a licensed production path
```

This is a sensible hierarchy — it's the same shape Stage 17B.1 already
implemented for futures (frozen provenance first, current config after),
extended with one new optional rung (#2) for the account-level override
that has an extension point but no implementation (§11). No changes needed
to build this in 17C.2 beyond adding the OTC branch to step 3.

---

## 21. Commercial licensing summary (internal dev / closed beta / public SaaS)

| Provider | Internal dev (yourself, local testing) | Closed beta (a handful of invited users) | Public SaaS (many paying subscribers) |
|---|---|---|---|
| OANDA | Yes — free/demo account | **No** — ToS bars third-party access/redistribution outright, no user-count carve-out | **No**, absent a bespoke written agreement (not self-serve) |
| Twelve Data | Yes — free tier | **Grow/Pro/Ultra tiers say "internal" only — a closed beta of real (non-employee) users likely already crosses into "external display," so Business/Venture is the correct tier even for beta**, not just eventual public launch | **Yes — Venture ($414/mo) or Enterprise ($916/mo)**, self-serve, publicly priced |
| Massive | Yes — free tier | **No** on Individual/Starter (explicit "individual use only," bars "end users other than you") | **Unknown pricing** — requires sales-negotiated Business Order Form |
| Tiingo | Yes — free/Power tier | **No** — even paid Commercial ($50/mo) is internal-use-only | **Unknown pricing** — requires sales-negotiated redistribution license |
| dxFeed | Unknown — no public self-serve tier at all | Unknown | Unknown — sales-only |

**Nothing here should be inferred from marketing language alone** — every
"No"/"Unknown" above is sourced to an actual ToS/license document cited in
§5–§8, not a pricing page's feature bullets.

## 22. Shared R2 cache — recommendation

**Same one-UTC-day-immutable-chunk architecture as Stage 17B, with one
addition: the price basis must be part of the cache key**, since (unlike
futures, which has exactly one series) an OTC provider *could* eventually
serve multiple series (MID today, potentially BID/ASK later per §14/§15
V2). Recommended key shape, directly extending the existing
`market-data/databento/{dataset}/{contractSymbol}/1m/{date}` pattern:

```
market-data/{provider}/{priceBasis}/{providerSymbol}/1m/{date}
```

e.g. `market-data/twelvedata/MID/EUR_USD/1m/2026-09-10`. This is forward-
compatible with a future BID/ASK addition without a key-format migration —
`BID`/`ASK` simply become additional values already representable in the
existing path shape.

**Licensing constraint on this (Stage 17B.1 §10/§11's lesson repeated
here):** Twelve Data's ToS caps retention to "the duration of the
subscription" and mandates deletion within 30 days of termination (§6) —
this is **not** a permanent archive right the way Databento's (once
confirmed) redistribution terms might be. **Recommendation:** build the
cache exactly like Databento's (opt-in, `TWELVEDATA_R2_CACHE_ENABLED`,
defaulting off), but add a documented, enforced retention/purge job as a
17C.2+ requirement — not optional, since indefinite retention past a lapsed
subscription would violate the license. This is a real, concrete difference
from the Databento cache (whose report never mentioned a retention ceiling)
and must not be silently copy-pasted.

## 23. Data volume estimate (rough)

Per weekly Replay session, 5 trading days × ~1,440 1-minute bars/day ≈ 7,200
bars/asset/week; a JSON bar (`{ts,o,h,l,c,v}`) is roughly 60–90 bytes
compact, so **~500KB–650KB/asset/week (MID only)**, or **~1–1.3MB/asset/week
if BID+ASK were both stored (V2)** — roughly double, not more, since it's
still just two more numeric series, not two full duplicate payloads with
overhead. For "5 assets weekly": ~2.5–3.5MB/week MID-only. For "5 assets
monthly" (~4x the days): roughly ~10–14MB/month MID-only. These are trivial
figures for R2 — the real constraint is never storage cost, it's the
licensing retention ceiling from §22, which bounds how long any of this can
be kept regardless of how cheap it is to store.

**Cross-user shared-cache benefit:** every additional user reviewing the
same asset/date pays zero incremental provider API cost once one user has
populated that day's cache entry — same benefit shape as the Databento L2
cache. For a common pair like EURUSD this could plausibly eliminate the
large majority of repeat provider calls across a user base reviewing
overlapping recent weeks, though no real usage data exists yet to size this
precisely (flagged as an estimate, not a measurement).

## 24. Execution-engine impact if BID/ASK (V2) is ever built

Conceptual audit only — nothing here is being built now:

- **Separate `CandleSeries` per side** — the execution engine currently
  consumes one `Candle[]` (see `advanceExecutionIfNeeded` in
  `replay-market-panel.tsx`, `visibleCandles`). V2 would need it to accept
  two aligned series (BID/ASK) instead of one, or a `Candle` shape carrying
  both sides per bar.
- **A quote abstraction** — something like `{timestamp, bid: OHLC, ask: OHLC}`
  rather than a plain `Candle`, so downstream code (chart, execution,
  aggregation) has one place to pick "which side for this operation" instead
  of threading a side parameter through every call site.
- **A spread-aware `OrderFillEngine` change** — today's fill logic (whatever
  currently checks "did price cross this level") would need to check the
  ASK series for a BUY-side fill/stop and the BID series for a SELL-side
  fill/stop, per §13's recommended mapping. This is a logic change inside
  the existing engine, not a new engine.
- **Dual-stream fetch/cache/provenance** — `getHistoricalCandles`,
  `market-data-cache.ts`, and `CandleProvenance` all currently assume one
  series per (provider, symbol, day); V2 needs two cache entries per day
  (§22's key already anticipates this) and a provenance record that can
  name both.

**This is a real but bounded, additive change** — no existing V1 code needs
to be rewritten to add it later; the no-hindsight `visibleCandles` chokepoint
(Stage 17B.1 §13) stays the single source of truth regardless of how many
series feed into it.

## 25. Keep the R-based review philosophy central

Replay's purpose is "what should I have done," not broker-exact fill
reproduction. §15's V1 recommendation follows directly from this: spending
17C.2 engineering effort on BID/ASK spread modeling before it's provider-
available (only OANDA, licensing-blocked) and before any evidence exists
that MID-only approximation misleads trader self-review, would be building
institutional-execution-simulator precision the product doesn't need yet.
Stage 15.2's R-normalized comparison already absorbs small OTC price
disagreement — that's the correct level of accuracy for a behavioral review
tool, and V1 should be built to match it, not exceed it speculatively.

---

## 26. Recommendation matrix

| Provider | Forex coverage | XAUUSD | BID/ASK/MID | 1m history | External display | Cache/storage | API quality | Vercel fit | Likely cost | Source semantics clarity | Traditorium suitability |
|---|---|---|---|---|---|---|---|---|---|---|---|
| **OANDA** | Excellent | Excellent | Excellent (all 3) | Good (exact depth unconfirmed) | **Blocked** (no redistribution) | Unknown/likely blocked | Excellent | Good | Free (moot — blocked) | Excellent (documented broker-quoted) | Low (V1) / High (if negotiated later) |
| **Twelve Data** | Good | Good | Limited (MID only) | Good (~1yr@1m) | **Good** (Venture tier, self-serve) | Good (subscription-bounded, needs purge job) | Good | Good | $414–916/mo | Good (documented aggregate methodology) | **High** |
| **Massive** | Limited (split products, gold unclear) | Unknown | Unknown | Good (10yr@Starter) | Limited (sales-only Business tier) | Unknown | Good | Good | Unknown | Unknown | Limited |
| **Tiingo** | Good | Good (folded into FX) | Unknown | Good (~3yr@1m) | Limited (sales-only redistribution license) | Unknown | Good | Good | $50/mo (self-serve tier insufficient for display) | Limited | Limited |
| **dxFeed** | Unknown | Unknown | Unknown | Unknown | Unknown (inferred plausible, unconfirmed) | Unknown | Unknown | Unknown | Unknown (sales-only) | Unknown | Limited (not self-serve accessible) |

---

## 27. Primary recommendation

### Primary Forex/XAUUSD provider: **Twelve Data**

**Why:** the only provider researched with a **self-serve, publicly priced,
explicitly-worded commercial redistribution license** (Venture tier,
$414/mo) — every other candidate either blocks redistribution outright
(OANDA, Massive/Tiingo individual tiers) or requires an opaque
sales-negotiated agreement (Massive/Tiingo/dxFeed business tiers) that can't
be scoped or budgeted before a sales call. Price basis is clearly documented
(aggregated MID across 60+ named liquidity sources) — not the ideal
broker-quoted BID/ASK fidelity, but honestly disclosable, which is this
stage's core requirement (§1). Technical fit is solid: adequate 1m depth,
ample rate limits at the required tier, and a symbol/coverage set that maps
cleanly onto Traditorium's existing FOREX/METALS/INDEX asset classes.
**Future broker-specific path:** none of this blocks Option C's hybrid
design (§9) — Twelve Data becomes the permanent Option A default regardless
of whether a broker-specific override is ever built.

### Second-best alternative: **OANDA**

**Why:** technically superior in every dimension that matters for fidelity
(true BID/ASK/MID, broker-quoted semantics, free, fast) — but not viable as
a V1 default because its standard terms categorically prohibit the
redistribution-to-many-end-users model Traditorium needs. Recommended path:
revisit OANDA specifically as the **V2 BID/ASK upgrade** (§14/§15) *if and
only if* a direct commercial conversation with OANDA yields a written
redistribution license — do not build against OANDA speculatively before
that conversation happens, since the current terms are an explicit blocker,
not an ambiguous gray area.

## 28. Initial execution fidelity: **V1 MID-only**

See §15 for full reasoning. Restated briefly: Replay's product purpose is
behavioral self-review in R-multiples, not broker-exact fill reproduction;
no self-serve/licensed provider offers BID/ASK today; and building spread
modeling ahead of both provider availability and demonstrated user need
would be premature precision. **Upgrade path:** V2 BID/ASK, gated on OANDA
(or equivalent) licensing becoming available — see §24 for the bounded,
additive engineering change that upgrade would require.

## 29. Final source-resolution architecture

```
Exact broker/detected symbol (e.g. "XAUUSD.a", "EUR/USD", raw trader text)
        │  preserved verbatim, never destroyed (Trade.assetSymbol /
        │  TradePlanScreenshot.detectedSymbol already do this — Stage 17B.1 §6)
        ▼
Canonical instrument (instrument-catalog.ts: "XAUUSD")
        │  via parseSymbol()'s broker-prefix/suffix stripping + ALIASES table
        │  — extend ALIASES for broker-suffix patterns (".a", ".raw", etc.)
        │  the same way TradingView suffixes are already stripped; NEVER
        │  collapse a distinct instrument (Stage 17B.1 §1 lesson: NAS100 CFD
        │  stays NAS100, never becomes NQ futures candles — §20 of this
        │  stage's prompt, confirmed unchanged)
        ▼
Market-data source resolver (resolveMarketDataProvider(canonicalSymbol,
        account?) — extended per §11's extension point, asset-class-routed
        per §20's hierarchy: FUTURES→Databento, FOREX/METALS/OTC-INDEX→
        Twelve Data)
        ▼
Provider symbol (e.g. Twelve Data's "EUR/USD" — never leaked past the
        adapter boundary, exactly like Databento's ProviderSymbolResolution)
        ▼
Price basis (MID for V1 — §13)
        ▼
Historical candles (fetched/cached per §22's extended R2 key shape)
        ▼
Frozen Replay provenance (CandleProvenance — §18, freeze-once policy
        unchanged — §19)
```

This is a direct extension of the architecture Stage 17B/17B.1 already
built for futures — same shape, same freeze-once/licensing-kill-switch
discipline, same "never collapse distinct identities" discipline — with one
new resolver branch (OTC asset classes → Twelve Data) and one new optional
parameter (account, for the future per-account override extension point).
No new architectural pattern is being introduced.
