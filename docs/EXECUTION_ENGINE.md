# Quantity-Ledger Execution Engine — Phase 1 (pure domain)

`src/domain/execution/` is a pure engine: it has no Prisma, services, UI,
API or persistence. Nothing in the app calls it yet. Legacy trades are
untouched: the engine never converts them and never invents a quantity for
them.

## Canonical direction

> **Risk % determines the budget.
> Initial stop + instrument economics determine executable quantity.
> Quantity + actual price movement determine PnL.
> Realized PnL / frozen intended risk determines realized R.**

Intended risk → quantity calculation → executable quantity → effective risk →
actual fills → realized PnL → realized R relative to intended risk.

A percentage, such as "close 50%", is only an input convenience. The fact
that gets recorded is a **quantity**.

## Modules

| File | Responsibility |
| --- | --- |
| `precision.ts` | `ExecDecimal`, an isolated decimal.js clone (40 significant digits, HALF_EVEN); `quantizeDown`, `roundMoney`, `floorMoney`, `roundR` |
| `instrument-spec.ts` | `resolveExecutionSpec`: account override → user override → catalog → `INSUFFICIENT` |
| `value-per-unit.ts` | `computeValuePerPriceUnit` (currency-neutral, explicit conversion), `describeDistance` (pips/points/ticks, display only) |
| `sizing.ts` | `sizePosition`: budget → raw → executable quantity → effective risk |
| `partial-close.ts` | `quantityForPercentOfRemaining`: step-quantized close of the current remaining quantity, with residual absorption |
| `fill-reducer.ts` | `reducePosition`: per-fill and cumulative quantity, PnL and R; weighted average exit; unrealized PnL |

## Instrument spec resolution

Each field is resolved from the first layer that states it, and its source is
recorded in `spec.sources`:

1. `ACCOUNT_OVERRIDE`: the broker or account's own contract terms.
2. `USER_OVERRIDE`: the trader's instrument override.
3. `CATALOG`: `domain/trade-plan/instrument-catalog.ts`, looked up by exact
   canonical symbol or declared alias. There is no broker-suffix stripping
   and no symbol heuristics. On top of the catalog's economics, the asset
   class contributes:
   - its pricing model: FX, metals, index CFDs and crypto use
     `CONTRACT_SIZE`; futures use `TICK_VALUE`;
   - its published quantity convention: FX and metals trade in lots with
     step and minimum 0.01; futures trade whole contracts with step and
     minimum 1. No maximum is assumed.
4. Otherwise `INSUFFICIENT`, with `missing[]` and `invalid[]` listing the
   problem fields.

For example, an index CFD's contract size is set by the broker and is not in
the catalog, so `NAS100` without an override resolves to `INSUFFICIENT`
(contract size and quantity fields missing).

With no catalog entry, the pricing model is inferred only from which
economics an override states: contract size alone means `CONTRACT_SIZE`;
tick size plus tick value alone means `TICK_VALUE`. If both are stated, the
model must be given explicitly.

## Value per price unit

```
accountValuePerPriceUnit = quoteValuePerPriceUnit × rate(quote → account)
  CONTRACT_SIZE: quoteValuePerPriceUnit = contractSize
  TICK_VALUE:    quoteValuePerPriceUnit = tickValue / tickSize
```

- EURUSD's $10 per pip per lot is derived (0.0001 × 100,000), never assumed.
- If the quote and account currencies match, the rate is 1. That is identity,
  not an assumption.
- Otherwise the caller must pass an explicit `{ from, to, rate }`, or the
  result is `CONVERSION_REQUIRED`. There is no FX lookup and no 1:1 fallback.

## Sizing

```
intendedRiskAmount  = floorMoney(balanceBasis × riskPercent / 100)
lossPerQuantityUnit = |entry − initialStop| × accountValuePerPriceUnit
rawQuantity         = intendedRiskAmount / lossPerQuantityUnit
executableQuantity  = min(quantizeDown(rawQuantity, step), maxQuantity)
effectiveRiskAmount = executableQuantity × lossPerQuantityUnit   (≤ intended)
```

- If the executable quantity is below `minQuantity`, the result is
  `CANNOT_SIZE_WITHIN_RISK`, which reports `riskAtMinQuantity`. Quantity is
  never raised beyond the intended risk.
- If the quantity is capped at `maxQuantity`, the result is flagged
  `cappedAtMax`.
- If the stop is on the wrong side of entry (or equals it), the result is
  `INVALID`.

## Percent-of-remaining close

```
closeQuantity = quantizeDown(remaining × percent / 100, step)
```

- 100% closes exactly the remaining quantity.
- If the close would leave a positive remainder below `minQuantity`, that
  remainder is absorbed into the close (reported as `absorbedResidual`).
- A request smaller than one step returns `BELOW_STEP`.
- A request below the minimum returns `BELOW_MIN_QUANTITY`.
- A close is never rounded up beyond what was asked.

## Fill reducer

```
priceDelta  LONG = exit − entry          SHORT = entry − exit
fillPnl     = roundMoney(priceDelta × executedQuantity × accountValuePerPriceUnit)
realizedPnl = Σ fillPnl
fillR       = fillPnl / intendedRiskAmount
realizedR   = realizedPnl / intendedRiskAmount
weightedAverageExit = Σ(price × qty) / Σ qty
unrealizedPnl       = priceDelta(mark) × remaining × accountValuePerPriceUnit
```

The R denominator is the frozen **intended** risk, never the effective risk.
A stop-out at 0.83 lots against a $1,000 budget is **−0.996R**, and it is
deliberately not normalized to −1R.

Invariants are enforced. A violation returns `INVALID` and names the fill.

- `initialQuantity > 0` and is a multiple of the step.
- Every executed quantity is `> 0`, a multiple of the step, and
  `≤ remainingBefore`.
- `remainingAfter = remainingBefore − executed ≥ 0`.
- `Σ closed + remaining = initialQuantity`.
- `fullyClosed ⇔ remaining = 0`.

Phase 1 reduces closing fills only. Reversal and correction fills belong to
the Phase 2 ledger.

## Rounding policy

| Value | Rule |
| --- | --- |
| Quantities | Quantized DOWN to an exact step multiple. Never rounded otherwise. |
| Intended risk (budget) | Rounded DOWN to the money scale (default 2 places). |
| Booked fill PnL | Rounded HALF-EVEN to the money scale, per fill. |
| Realized PnL | The exact sum of booked fills. |
| Effective risk, unrealized PnL, R | Unrounded. Presentation uses `roundMoney` / `roundR`. |
| `moneyScale: null` | No money rounding (exact math). |

All arithmetic is Decimal. JS numbers are accepted only at the boundary,
through their shortest decimal string.

## Worked example (tested)

Setup:
- Balance $100,000, risk 1%, so the budget is $1,000.
- XAUUSD (catalog: contract size 100, step 0.01). Long at 2000, stop at
  1988.
- Loss per lot: 12 × 100 = $1,200.
- Raw size: 0.8333… lots. Executable size: **0.83** lots.
- Effective risk: $996.

| Action | Requested | Closed | Remaining | Fill PnL | Fill R | Cumulative R |
| --- | --- | --- | --- | --- | --- | --- |
| 50% of remaining @ 2012 | 0.415 | 0.41 | 0.42 | $492 | 0.492 | 0.492 |
| 50% of remaining @ 2024 | 0.21 | 0.21 | 0.21 | $504 | 0.504 | 0.996 |
| Close remaining @ 2006 | 0.21 | 0.21 | **0** | $126 | 0.126 | **1.122** |

## Legacy relationship

`legacy-comparison.test.ts` contains a testing-only helper. It proves the
engine reproduces `computeRealizedR` (to 12 decimal places) when:
- the quantity is unrounded, so effective risk equals intended risk;
- exit percentages are weights of the original position;
- there are no fees and no spec differences.

It also shows the deliberate divergence once quantity is rounded to the
step: legacy gives −1R, the engine gives −0.996R. The helper is not a
migration or backfill path.

---

# Phase 2 — Performance Account quantity ledger

Phase 2 makes `QUANTITY_LEDGER` real for the virtual Performance Account.
`LEGACY_PERCENT` behaviour is unchanged.

```
risk budget → frozen sizing inputs → executable quantity → immutable fills
→ realized PnL → realized R → existing canonical settlement outputs
```

## Execution model

- **Column:** `Trade.executionModel` (`LEGACY_PERCENT` | `QUANTITY_LEDGER`),
  default `LEGACY_PERCENT`. Existing rows took the column default; nothing
  was backfilled.
- **When it's chosen:** once, at **first actual entry**.
  - The only path that creates a ledger trade is Today V3 `recordFirstEntry`
    with `QUANTITY_LEDGER=on` (env, default off).
  - The flag only affects that selection. A ledger trade keeps settling
    through its ledger if the flag is later turned off.
- **No silent downgrade:** when the flag is on, an entry the engine can't
  size is **rejected** with `QuantityLedgerEntryError`. It is never quietly
  made `LEGACY_PERCENT`. Codes:
  - `INITIAL_STOP_REQUIRED`
  - `INITIAL_STOP_INVALID`
  - `INSTRUMENT_SPEC_INSUFFICIENT`
  - `CONVERSION_REQUIRED`
  - `CANNOT_SIZE_WITHIN_RISK`
  - `INVALID_SIZING`
  - `RISK_PERCENT_INVALID`
  - `ALREADY_ENTERED`
  - `BACKTEST_NOT_ALLOWED`

  `recordEntryAction` returns the code and its details as `ledger: { code, details }`.
- **Database rules:**
  - The model is immutable once the Performance snapshot exists.
  - A backtest trade can never be `QUANTITY_LEDGER` (CHECK constraint).

## Sizing at first entry (`enterQuantityLedgerTrade`)

All of this runs in one transaction under the advisory lock `perf-ledger:<tradeId>`:

1. Re-read the trade and confirm no snapshot exists. A double submit with the
   same entry is an idempotent no-op; a different entry is rejected as
   `ALREADY_ENTERED`.
2. **Genuine initial stop:** the `actualStopLoss` submitted with the entry,
   otherwise the plan stop or planned stop that existed before execution.
   The stop is frozen here, so a stop typed later can never become 1R.
3. Resolve the spec (user override, then catalog). Apply the currency rule:
   quote = account currency gives rate 1; otherwise `CONVERSION_REQUIRED`.
   Check risk % (range and max).
4. Compute balance-before using the same compounding rule as legacy.
5. Size: budget, executable quantity, effective risk.
6. Write the trade's entry facts and `executionModel`, then create the sized
   snapshot.

**What the snapshot holds for a ledger trade:**
- `riskAmount`: **the intended budget**, i.e. the engine's rounded-down amount
  and the realized-R denominator. It is not duplicated in another column.
- `effectiveRiskAmount`
- `rawQuantity`
- `executableQuantity`
- `quantityUnit`
- `valuePerPriceUnit`
- `sizingConversionRate`
- `specSnapshot`: the complete resolved economics.
- `sizingVersion`

The sizing columns are write-once (DB trigger), together with the frozen risk
inputs. Every later ledger calculation reads only `specSnapshot`, so catalog or
`UserInstrumentSpec` edits never rewrite history.

## PositionFill (append-only)

PositionFill is the economic execution history of a ledger trade.
`TradeActualPartialExit` stays the legacy history, and the same execution is
never written to both (DB triggers on each side).

**Ledger owner:** exactly one of `performanceSnapshotId` (Phase 2) or
`accountExecutionId` (reserved for Phase 3). `sequence` is unique per owner.

**Stored** (immutable facts):
- kind and source;
- requested percent and its basis, or the requested quantity;
- executed quantity and price;
- `quantityBefore` / `quantityAfter` (append-time assertions);
- booked `grossPnl` (half-even, cents);
- `fees` (null for Performance);
- the fill's `conversionRate`;
- `executedAt`;
- plan provenance (`planVersionId` + `plannedTargetOrder`; live `PlannedTarget`
  rows are recreated on every plan save, so they are never referenced);
- `reversesFillId` / `replacesFillId`;
- `note`, `createdAt`.

**Derived on replay:** net PnL, per-fill and cumulative R, remaining quantity,
closed state, weighted average exit.

**Database enforcement:**
- UPDATE is always rejected.
- DELETE is rejected while the owning trade exists; cascades from deleting the
  trade or user still work.
- A ledger snapshot cannot be deleted while its trade exists.

**Ordering:** fills are ordered by `sequence` only; `executedAt` may be
backdated. `replayLedger` re-derives and verifies every stored fact on every
read. Any mismatch is `LEDGER_CORRUPT`.

## Fills, reversals, settlement

- **`recordCloseFill`:**
  1. Take the lock and load the frozen snapshot and the complete ledger.
  2. Plan the close, by quantity or by percent of the current remaining
     quantity.
  3. Append it at the next sequence.
  4. Re-settle and commit, all in one transaction.
  5. Sync the lifecycle afterwards.
- **`correctFill`:** appends a **REVERSAL** that exactly negates an
  **unreversed CLOSE of the same ledger**, then optionally a replacement CLOSE
  (`replacesFillId`). The rules are enforced in the service and again by the
  DB insert trigger:
  - another trade's or another owner's fill is not found;
  - a REVERSAL can't be reversed;
  - a fill can be reversed only once (unique `reversesFillId`);
  - the quantity, price and rate must match the target, and PnL and fees must
    be its exact negation.
- **Settlement** (`ledger-settlement.service.ts`) is a pure function of the
  frozen snapshot plus fills in sequence order.
  - **Fully closed:** writes the existing canonical outputs:
    - `realizedR` (half-even, 4 places);
    - `performancePnl` (sum of booked fills);
    - `settledAt`;
    - the Performance allocation's `closingPnlGross` / `closingPnlNet`;
    - `Trade.actualRR` (half-even, 2 places).
  - **Not fully closed** (including re-opened by a reversal): clears all of
    them, **including `actualRR`**. This applies to ledger trades only; legacy
    keeps its one-way `actualRR`.
  - Journal, Analytics, Close, Edge Review, AI, `settledWinLossClass` and
    compounding all read these unchanged.
- **Dispatch:** `settlePerformanceTrade` selects exactly one engine by
  `Trade.executionModel`. The legacy branch is the original code, unchanged.
- **Legacy-path guards:**
  - `upsertPartialExit`, `deletePartialExit` and `mapPartialToTarget` reject
    ledger trades.
  - `updateTradeSections` rejects `actualExit` and any change to `actualEntry`
    on a ledger trade. Ledger trades keep `Trade.actualExit` **null**.

## Reader projection (derived, in memory)

`ledger-projection.service.ts` (`withLedgerProjection(s)`) is the single place
existing readers get a ledger trade's exits. It swaps the (empty)
`actualPartialExits` for rows projected from the effective fills:
- percent of the **original** quantity, with the last close absorbing the
  division remainder so a closed ledger sums to exactly 100;
- price, time and per-fill R.

It also attaches `ledgerRealizedRSoFar` (ledger PnL / intended risk), which
`computeTradeExecutionSummary` uses through `realizedRSoFarOverride`.

It's used by:
- lifecycle sync;
- Trade Review and Review V3;
- Close (day summary and the Journal calendar);
- canonical analytics;
- Edge Review's actual-trade comparison.

Nothing is persisted, and no projection row is ever written.

## Backtesting

Unchanged and isolated:
- Ledger services reject backtest scope and backtest trades.
- Today V3 never selects the ledger in a backtest.
- `PositionFill` carries the `BACKTEST_ISOLATION` trigger.
- `Trade_executionModel_live_only` (CHECK) forbids a backtest ledger trade.

## Rollback

- **Primary rollback:** `QUANTITY_LEDGER` off. Always safe; existing ledger
  trades keep settling.
- **Reverting the code to pre-Phase-2:** safe only while there are no ledger
  trades. Check with:

  ```sql
  SELECT count(*) FROM "Trade" WHERE "executionModel" = 'QUANTITY_LEDGER';
  ```

  The old settlement treats a ledger trade as having no exits, so it would
  clear that trade's result.
- **The migration:** additive only. Dropping its tables and columns is
  data-safe under the same condition.
