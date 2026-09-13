# Market-Data Production Readiness (Stage 17D)

**No provider credentials were available during this stage** (no
`DATABENTO_API_KEY` or `TWELVE_DATA_API_KEY` was present in this
environment). Per this stage's own instructions, live verification was
**not faked**. Everything static/code-level that could be done without
credentials was done; everything requiring a live connection is recorded
below as **PENDING CREDENTIALS**, with an exact checklist for whoever runs
it next.

**Overall status: CODE ACCEPTANCE COMPLETE / LIVE ACCEPTANCE PENDING.**

---

## 1. End-to-end pipeline (audited, no unexpected divergence found)

```
Replay asset (session.assetSymbols — CLIENT-supplied, only
  .trim().toUpperCase()'d at session creation; see §1a below)
        │
        ▼
canonical instrument resolution (parseSymbol, inside the provider
  resolver AND each adapter's own resolveSymbol — not at session
  creation time)
        │
        ▼
provider resolver (resolveMarketDataProvider — futures→Databento,
  5 OTC symbols→Twelve Data, everything else→Fixture; each gated on
  isAvailable() AND isProviderDisplayPermitted())
        │
        ▼
provider symbol (adapter-internal, never leaked to the client)
        │
        ▼
daily 1m candles (provider.fetchCandles — always ≤1 UTC day per call)
        │
        ▼
cache (L2 R2, opt-in, provider-specific module + prefix; L1 in-process,
  provider-agnostic, now with in-flight dedup — see §1b)
        │
        ▼
prefetch (replay-prefetch-window.ts — provider-agnostic, day-aligned,
  ≤MAX_CHUNK_DAYS batching; unaffected by which provider is behind it)
        │
        ▼
Replay Clock / visible candles (visible-candles.ts — the single
  no-hindsight chokepoint, reads whatever baseCandlesByAsset holds
  regardless of provider)
        │
        ▼
execution engine (advanceReplayTradeExecution → processCandles — takes
  plain Candle[], has zero knowledge of provider origin)
```

### 1a. One real divergence found: `assetSymbols` is client-supplied, not derived from `Trade`

`createReplayReviewSession` (`replay-review.service.ts`) does **not**
query `Trade` rows to populate `assetSymbols` — it takes whatever string
array the client sends and only applies
`.trim().toUpperCase()`. Canonicalization (broker-suffix stripping,
alias resolution) happens **later**, inside `resolveMarketDataProvider`
and each adapter's own `resolveSymbol` — not at session-creation time.
This was previously assumed-but-unverified (Stage 17C.2 explicitly flagged
it as untested); Stage 17D added `replay-review.service.test.ts`'s new
"End-to-end Replay session path" suite, which proves the raw string
still resolves correctly by the time candles are fetched (§9/§10 below).
**Not a bug** — just a divergence from an implicit assumption that
canonicalization happened earlier in the pipeline than it actually does.
One consequence worth documenting: two trades logged as `"XAUUSD"` and
`"XAUUSD.a"` produce **separate session asset-list entries, separate
provenance-map keys, and separate L1/L2 cache entries**, even though both
resolve to the identical Twelve Data ticker — a minor cache-fragmentation
inefficiency, not a correctness issue (both still fetch/display correct
data).

### 1b. Fixed during this stage: concurrent-request dedup gap

`getHistoricalCandles`'s per-day cache loop was check-then-act
(`dayCache.get` → miss → `await provider.fetchCandles`) with no
protection against two concurrent callers for the same
(provider, symbol, day) both missing the cache and both hitting the real
provider — a genuine production concern (two users opening the same
popular asset/day at once), not just an internal race. Fixed with a
small, per-process, in-memory `Map<key, Promise>` of in-flight fetches
(`market-data.service.ts`'s `fetchDayDeduped`) — no distributed locking,
no cross-instance coordination. Tested (`market-data.service.test.ts`,
"concurrent-request dedup" suite).

No other divergence was found between the intended and actual pipeline.

---

## 2. Twelve Data price-basis correction

**Changed `priceBasis: "MID"` → `priceBasis: "AGGREGATED"`** across the
adapter (`twelve-data-provider.ts`), its cache module's test fixtures,
`replay-review.service.test.ts`, the Replay source badge
(`replay.actions.ts`'s `buildSourceLabel`, now
`"Data: Twelve Data · XAU/USD · Aggregated"`), and both docs
(`TWELVE_DATA_MARKET_DATA.md`, `FOREX_XAUUSD_MARKET_DATA_DECISION.md` —
the latter got a correction notice at the top rather than being rewritten,
preserving the original point-in-time research record).

**Why**: Twelve Data's own documentation confirms "mid-price" wording only
for its WebSocket real-time product; it was never independently confirmed
to apply, word-for-word, to the REST `/time_series` historical endpoint
this adapter actually calls. Stage 17C.2 inferred `MID` was probably still
correct ("a vendor wouldn't run two pricing engines"); Stage 17D's audit
rejected that as insufficient grounds for a persisted, user-facing factual
claim. `AGGREGATED` asserts only what IS confirmed (a weighted-average
across multiple liquidity sources), required no new field/enum (it was
already in `FOREX_XAUUSD_MARKET_DATA_DECISION.md`'s original closed set:
`MID | BID | ASK | AGGREGATED | BROKER_QUOTED | INDICATIVE`), and is a pure
labeling correction — see §3 for why execution semantics are unaffected.

---

## 3. Production-readiness state model

Operational/documentation state only — **no database model added**, per
this stage's explicit instruction. Four states, defined here and tracked
in the matrix (§21 below):

- **IMPLEMENTED** — adapter/code/tests exist and pass against mocked
  provider responses.
- **LIVE_VERIFIED** — successfully tested against the actual, real
  provider API (not mocked) — the checklists in §5-8 below.
- **LICENSE_APPROVED** — Traditorium holds the actual contractual rights
  for the intended deployment (not inferred from a public pricing page).
- **PRODUCTION_ENABLED** — both LIVE_VERIFIED and LICENSE_APPROVED are
  true, and the corresponding `*_EXTERNAL_DISPLAY_ENABLED` flag is
  intentionally set in the deployed environment.

---

## 4. Databento — live acceptance checklist (§5/§6) — **PENDING CREDENTIALS**

No `DATABENTO_API_KEY` was available. Nothing below has been run against a
live connection. Checklist, to run once a key exists:

For **each** of GC, MGC, ES, MES, NQ, MNQ independently (a pass on one
does not imply a pass on another — they are separate literal roots):

- [ ] Canonical instrument resolves correctly (`lookupInstrument`/
      `parseSymbol` already unit-tested — confirm live symbol acceptance).
- [ ] Continuous root (`{root}.v.0`) resolves via `symbology.resolve`.
- [ ] Literal historical contract returned matches the expected shape for
      that root (e.g. `MESZ6`, not `ESZ6`).
- [ ] `timeseries.get_range` returns native 1m OHLCV.
- [ ] Timestamps are interval-open UTC (`ts_event` as documented).
- [ ] Price scale is correct — **critical**: confirm `pretty_px=true` is
      actually honored; if not, every chunk will fail with
      `PROVIDER_DATA_ERROR` by design (Stage 17B.1's "fail safely rather
      than guess" policy) rather than silently mis-scale.
- [ ] OHLC values are plausible against an independent chart (§11).
- [ ] Volume is plausible (non-zero during active session hours).
- [ ] Real gaps remain gaps (no fabricated bars).
- [ ] Provenance records the exact literal contract.
- [ ] Source badge displays the exact contract (`"Data: Databento · MESZ6"`).
- [ ] Replay Clock hides the bar until its close (already proven
      structurally via `visible-candles.test.ts`'s "prefetch never leaks
      future data" suite — re-confirm visually with real data).

**Rollover test (§6, mandatory before declaring Databento live-verified):**
choose one historical period known to cross a rollover for at least one
root.

- [ ] Continuous symbol resolver returns literal contracts that actually
      change across the boundary.
- [ ] Correct date ranges assigned to each literal contract.
- [ ] No back-adjustment (raw, literal prices on both sides of the
      boundary).
- [ ] No synthetic bridge candle at the boundary.
- [ ] No duplicate timestamps across the two segments.
- [ ] No accidental missing range introduced by segmentation (segment
      boundaries are contiguous, not overlapping-with-gaps).
- [ ] Provenance records BOTH segments.
- [ ] Replay crosses the boundary without crashing (chart, execution,
      aggregation all keep working across it).

Mocked-response coverage already exists for the resolution/segmentation
logic itself (`databento-provider.test.ts`'s rollover tests) — this
checklist is about confirming the SAME logic against a real response
shape, not re-deriving it.

## 5. Twelve Data — live acceptance checklist (§7) — **PENDING CREDENTIALS**

No `TWELVE_DATA_API_KEY` was available. For **each** of EURUSD, GBPUSD,
USDJPY, XAUUSD, XAGUSD independently:

- [ ] Provider symbol accepted (`EUR/USD`, `GBP/USD`, `USD/JPY`,
      `XAU/USD`, `XAG/USD`).
- [ ] Native 1m bars returned.
- [ ] Timestamp semantics verified — confirm `datetime` really is bar-open
      and `timezone=UTC` really produces UTC wall-clock strings (both
      documented, neither independently re-confirmed against a live
      response).
- [ ] Timezone normalization correct (no deployment-locale dependency —
      already structurally guarded via `Date.UTC(...)` parsing, confirm
      the parsed values match reality).
- [ ] Newest/oldest ordering normalized correctly (adapter always
      re-sorts regardless of the `order` param's honored-or-not status —
      confirm real responses don't have some OTHER ordering surprise).
- [ ] OHLC values plausible (§11).
- [ ] No scale error — **critical**: confirm prices arrive as real decimal
      values, not raw fixed-point; if not, `PROVIDER_DATA_ERROR` fires by
      design rather than mis-scaling.
- [ ] Gaps preserved (no fabricated bars).
- [ ] Provenance correct (`priceBasis: "AGGREGATED"`, provider symbol
      correct).
- [ ] Source badge correct (`"Data: Twelve Data · XAU/USD · Aggregated"`).
- [ ] Exact no-hindsight boundary works (same chokepoint as Databento —
      provider-agnostic by construction).

**Historical depth (§8):** do NOT rely on Twelve Data's own marketing
copy (sources gave inconsistent "~1 year" vs. "multiple years" figures).
Test EURUSD and XAUUSD with increasingly older `start_date` values until
the real accessible limit becomes clear; document the observed boundary
here once run. `getSupportedRange`'s current floor (2015-01-01) is a
deliberately conservative placeholder, NOT a confirmed promise — update it
once the real boundary is known, or leave it conservative and let live
responses be the source of truth (current behavior).

## 6. Raw broker-symbol & exact futures-identity — code-level verification COMPLETE (§9/§10)

Unlike §4/§5 above, this did **not** require live credentials — it tests
internal routing/resolution logic, not live provider responses. **Done
this stage**, using the real session-creation path (not just the
adapter/catalog unit-test level Stage 17C.2 covered):

- `replay-review.service.test.ts`, "End-to-end Replay session path" suite:
  - A real `Trade` row with `assetSymbol: "XAUUSD.a"` + a session created
    with `assetSymbols: ["XAUUSD.a"]` → session stores `"XAUUSD.A"`
    (uppercase-only) → `fetchReplayCandlesWithProvenance(..., "XAUUSD.A", ...)`
    resolves to Twelve Data's real `XAU/USD` ticker, with a mocked live
    fetch proving the actual candles round-trip. The original `Trade` row's
    text is confirmed byte-for-byte unchanged after the fact.
  - A real `Trade` row with `assetSymbol: "MES"` + a session created with
    `assetSymbols: ["MES"]` → resolves to Databento's `MES.v.0`/`MESU6`
    (never `ES.v.0`/`ESU6`) — the mocked `symbology.resolve` call's own
    request URL is asserted to contain `symbols=MES.v.0` and NOT
    `symbols=ES.v.0`.
- Cross-provider isolation additionally confirmed at the routing layer
  (`market-data.service.test.ts`): futures never route to Twelve Data, OTC
  symbols never route to Databento, INDEX/CFD symbols (NAS100, US500)
  never route to Databento's futures data despite correlation, broker-
  suffixed OTC symbols route correctly once permitted.

## 7. Visual comparison (§11) — **PENDING CREDENTIALS**

Not performed — requires live data. Procedure, to run once credentials
exist: for a Databento symbol, compare the exact same literal contract's
candles (same timestamp, OHLC structure, session gaps) against an
independent chart for that contract. For a Twelve Data symbol, compare
broad swing structure, candle timing, and rough OHLC agreement against an
MT5/broker chart — minor deviations are EXPECTED and must not be treated
as a failure (this is the entire premise of Stage 17C.1's OTC-honesty
architecture); only a structurally wrong result (scale error, wrong
timeframe, systematically shifted timestamps) should fail this check.

## 8. Numerical diagnostic (§12) — implemented, code-level tested

`src/server/services/market-data/diagnostic.ts` — `dumpMarketDataSample()`
+ `formatDiagnosticTable()`. Dev-only, never imported client-side, never a
route, bounded to 2000 rows (never a bulk export tool). Reuses the real
`getProviderById`/adapter path — zero duplicated fetch/parse logic. A
companion self-skipping runner
(`diagnostic.manual.test.ts`, gated on `RUN_MARKET_DATA_DIAGNOSTIC=1`)
prints a sample table for manual eyeballing once credentials exist; unit
tests (`diagnostic.test.ts`) cover its own error handling and row-shaping
with mocked responses.

## 9. Cache cold/warm/corruption verification (§13/§14) — code-level COMPLETE

New `provider-cache-integration.test.ts` exercises the REAL cache modules
(only R2 transport mocked) together with each REAL adapter, for BOTH
providers:

- **Cold**: R2 miss → provider hit → validated → cached (asserted via the
  actual `PutObjectCommand` body).
- **Warm**: R2 hit → the adapter's own network fetch is asserted to NEVER
  happen (Databento: only its separate `symbology.resolve` call still
  fires, since that's not day-cached; Twelve Data: zero network calls at
  all).
- **Corrupt**: a cache envelope with a mismatched contract/symbol is
  rejected by the existing `isValidEnvelope` validation, the adapter
  correctly falls through to a live fetch, and a valid replacement is
  cached — no malformed candles ever reach the returned result.

This complements (not duplicates) the existing purely-cache-module-level
validation tests (`market-data-cache.test.ts`, `twelve-data-cache.test.ts`),
which already exhaustively prove `readCachedDay` rejects every kind of
invalid envelope; this new suite proves the ADAPTER's own orchestration
around that validation is correct.

## 10. Concurrent-request behavior (§15) — fixed and tested this stage

See §1b above.

## 11. Twelve Data credit-usage observations (§16) — **PENDING CREDENTIALS for real numbers; architecture confirmed by design**

No live measurement was possible. What's confirmed by code/tests:
opening a weekly Replay for N assets issues at most N × (days in the
rolling prefetch window, ≤`MAX_CHUNK_DAYS`=7) provider-level day-fetches
on first load, each independently L1+L2 cached; scrubbing/playback within
already-loaded days issues ZERO further provider requests (proven by §9's
warm-cache test); switching timeframe issues zero further provider
requests (client-side aggregation only, `aggregation.ts`); reopening the
same cached period issues zero further provider requests if the R2 L2
cache is enabled and the days are still cached (day-cache validated on
every read). **The architecture avoids per-candle provider requests by
construction** — there is no code path that fetches less than a full UTC
day. Real credit-consumption numbers require a live account and are
PENDING.

## 12. Replay timeframe aggregation (§17) — unaffected by provider, already tested

`aggregation.ts`/`visible-candles.ts` operate on plain `Candle[]` with zero
provider awareness — already proven compatible with real adapter output
via `databento-provider.test.ts`'s and `twelve-data-provider.test.ts`'s own
"Replay integration — candles through Clock/visibleCandles" suites (1m→5m
aggregation, no-hindsight boundary, all against REAL adapter-parsed
candles from mocked HTTP responses). No incomplete-HTF-candle or
fabricated-sub-bar issue exists structurally, since aggregation only ever
reads what's actually in the array — a provider gap simply produces a
smaller/partial higher-timeframe bucket, never a synthesized one
(`buildHigherTimeframeView`'s existing test coverage).

## 13. Execution engine with real-provider-shaped candles (§18) — code-level COMPLETE

`replay-trade.service.test.ts`'s new "execution engine with REAL
provider-parsed candles" suite: a market order fill + stop-loss close +
realized-R computation, fed candles that went through the REAL Twelve Data
adapter's actual datetime/price parsing from a mocked HTTP response
(not the `candle()` literal-object test helper) — reproduces the exact
same outcome as the Fixture-shaped equivalent test, with zero execution-
math changes. Proves the adapter output shape is fully compatible with the
execution engine's input expectations end-to-end, not just by type-system
inference.

## 14. Cross-provider isolation (§19) — COMPLETE, tested

- Futures never route to Twelve Data (`market-data.service.test.ts`,
  Twelve Data's own `resolveSymbol` also independently refuses futures
  symbols as defense-in-depth — `twelve-data-provider.test.ts`).
- Forex/metals never route to Databento (same suites).
- A frozen Databento session never silently becomes Twelve Data or
  Fixture (`replay-review.service.test.ts`'s licensing/provenance suites).
- A frozen Twelve Data session never silently becomes Databento or
  Fixture (same file, mirrored suite).
- INDEX/CFD symbols (NAS100, US500) never route to Databento's futures
  data despite correlation (explicit test, Stage 17B.1's lesson restated).

## 15. Licensing gate verification (§20) — COMPLETE, tested

For both providers, independently: API key present + external display
false → Fixture, never real data (`market-data.service.test.ts`).
Development override requires BOTH the explicit opt-in var AND
non-production `NODE_ENV` (tested both directions — works in dev, refused
in production even with the var set, for both providers independently).
Enabling one provider's flag never enables the other's (explicit test).

## 16. Secret/logging audit (§21) — COMPLETE, one fix applied

- API keys are read only via `process.env.*_API_KEY` inside each
  adapter's private `apiKey()` method — never `NEXT_PUBLIC_*`, never
  passed to client code.
- Neither adapter has ANY `console.log`/`console.warn` call that could
  print a URL or key (confirmed by grep — zero console statements in
  either adapter file).
- Databento authenticates via HTTP Basic Auth header — the key never
  appears in a URL string at all, so `url.toString()` (only ever passed to
  `fetch()`, never logged/thrown) carries no exposure.
- **Twelve Data authenticates via query parameter** — the key DOES sit in
  the request URL. Audited and found one residual risk: a non-4xx-auth
  error path could theoretically surface raw response text (up to 300
  chars) that, in an unrealistic vendor-quirk scenario, echoed request
  parameters back. **Fixed this stage**: added `redactApiKey()`, applied
  to the response body text (before JSON parsing) and to any network-layer
  error message, so the live key can never reach a returned error message
  or a log line even through an unanticipated path. Tested explicitly
  (`twelve-data-provider.test.ts`, two new redaction tests simulating both
  a vendor-echo and a network-error-message leak).
- `CandleProvenance`/the source badge carry no field capable of holding a
  secret by type — `providerId`, `priceBasis`, `contractSymbol`,
  timestamps only.

## 17. Provider error UX (§22) — COMPLETE, tested

Every failure mode maps to a distinct, non-raw-stack-trace, user-facing
`MarketDataError.message` via each adapter's `mapError`: credentials
missing, credentials invalid (401/403), rate limit (429, after bounded
retry), provider outage (5xx, after bounded retry), unsupported symbol
(404 / catalog miss), no historical coverage (`OUT_OF_COVERAGE`),
malformed provider response (`PROVIDER_DATA_ERROR`), external display
disabled (`PROVIDER_DISPLAY_DISABLED`). The client
(`replay-market-panel.tsx`) renders `result.error.message` through a
generic error-state UI — no code path substitutes synthetic data on a real
failure.

## 18. No-history state (§23) — already correct by construction

An empty `values`/candles array for a request fully inside
`getSupportedRange` returns `{ok: true, candles: []}` — genuinely distinct
from any failure path, which always returns `{ok: false, error}`. Already
tested for both providers ("never fabricates a weekend/session-break
candle"). No new code needed — the distinction was already reliable, just
not previously called out explicitly as satisfying this requirement.

## 19. Fixture labeling safety (§24) — confirmed, no gap found

`buildSourceLabel` unconditionally returns `"Synthetic Fixture"` for
`providerId === "fixture"` before any other logic runs — cannot be
confused with real data in the UI. Fixture is reached only when a real
provider is unavailable/unsupported/not-yet-licensed for that symbol,
which is the intended, clearly-labeled behavior (e.g. INDEX/CFD symbols
today, pending a real provider decision) — never a silent substitution for
a symbol a real provider DOES support but temporarily failed on (that path
returns a structured error instead, per §17).

---

## 20. Readiness matrix

| Provider | Asset class | Implemented | Live verified | Licensing approved | Production enabled |
| --- | --- | --- | --- | --- | --- |
| Databento | Futures (GC/MGC/ES/MES/NQ/MNQ) | **Yes** | **No — pending `DATABENTO_API_KEY`** | **No — not confirmed** (Stage 17A found licensing unresolved across every futures vendor evaluated) | **No** |
| Twelve Data | Forex/Metals (EURUSD/GBPUSD/USDJPY/XAUUSD/XAGUSD) | **Yes** | **No — pending `TWELVE_DATA_API_KEY`** | **No — only applicable once an actual Business/Venture-tier (or above) commercial subscription exists**, not inferred from public plan descriptions | **No** |

Neither `MARKET_DATA_EXTERNAL_DISPLAY_ENABLED` nor
`TWELVE_DATA_EXTERNAL_DISPLAY_ENABLED` should be set to `true` in any
production deployment until both LIVE_VERIFIED and LICENSE_APPROVED are
independently true for that provider.

## 21. Acceptance gates

**Databento production acceptance requires, at minimum:**
1. Live six-symbol test (§4) — all six roots independently.
2. Rollover test (§4) — at least one boundary, all invariants confirmed.
3. Timestamp/price verification against real responses.
4. No-hindsight verification with real data (chokepoint already provider-
   agnostic and tested; confirm no surprise with real timestamps).
5. Licensing confirmation in writing from Databento for this exact
   redistribution/display use case.

**Twelve Data production acceptance requires, at minimum:**
1. Live five-symbol test (§5).
2. Timestamp verification against real responses.
3. Price-source wording resolved — either written confirmation from
   Twelve Data that `/time_series` is a true mid-price series (permitting
   reversion to `MID`), or `AGGREGATED` stays permanent.
4. Historical depth observed (§5/§8) and, if materially different from the
   current conservative floor, `getSupportedRange` updated accordingly.
5. Cache/purge verified against a real R2 bucket + real cached data (unit-
   level cache logic is fully tested; an end-to-end run with real
   infrastructure has not been performed).
6. An applicable commercial plan (Venture tier or above) actually active,
   not merely priced/available.

---

## 22. Credential availability this stage

**Neither `DATABENTO_API_KEY` nor `TWELVE_DATA_API_KEY` was present.**
Every checklist item above marked PENDING CREDENTIALS was left exactly
that — not faked, not assumed passing. Everything markable as code-level
complete without a live connection was completed and tested this stage.

## 23. Explicit verdicts

### Databento: **CODE ACCEPTED**

Not LIVE VERIFIED (no key available — §4 fully pending). Not PRODUCTION
READY (also requires LICENSE_APPROVED, unconfirmed since Stage 17A).

### Twelve Data: **CODE ACCEPTED**

Not LIVE VERIFIED (no key available — §5 fully pending, including the
price-basis wording that can only be fully resolved by a live/written
vendor confirmation). Not PRODUCTION READY (also requires an actual active
commercial subscription with confirmed external-display rights, not yet
in place).

---

## 24. Explicitly out of scope this stage (per §29)

Not fixed, not expanded into: the pre-existing `TradeAccountAllocation`
test-teardown FK issue (confirmed still present, affects ~14 unrelated
test files' `afterAll` cleanup only — zero effect on actual test
assertions, all of which pass), old screenshot
`canonicalInstrumentSymbol` cosmetic rows (Stage 17B.1's known gap,
unrelated to this stage), the Dashboard legacy analytics path, and any
other pre-existing technical debt not touched by this stage's changes.
