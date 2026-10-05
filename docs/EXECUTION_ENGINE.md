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
