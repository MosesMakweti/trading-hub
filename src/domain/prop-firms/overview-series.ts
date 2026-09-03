/**
 * Prop Firm Overview — weekly Master-Account Capital and Cumulative Payouts
 * (spec §2, §3, §5-overview). Pure, decimal-safe, no React / Prisma / I/O.
 *
 * TWO independently-calculated series on a shared weekly timeline:
 *
 *  1. Master Account Capital — the combined closing balance of every eligible
 *     master/funded account that was active at each weekly endpoint. A
 *     snapshot per week, NEVER a cumulative sum of weekly balances (that would
 *     count the same capital again and again).
 *
 *  2. Cumulative Payouts — the progressive total of trader-received (net,
 *     post-profit-split) payouts, by confirmed/paid date.
 *
 * Week convention: **UTC ISO weeks, week-ENDING point** (the Sunday
 * 23:59:59.999Z that closes the ISO week). A date filter changes the visible
 * window only — neither series restarts at zero; the summary's "opening"
 * values come from the week immediately before the visible range.
 */
import { Decimal } from "decimal.js";

import { isFundedStageType, type StageTypeLike } from "./metrics";
import { buildAccountBalanceSeries, type RawBalanceEvent } from "./balance-curve";
import type { UserPropFirmDTO } from "@/types/prop-firms";

export interface OverviewStageInput {
  type: string;
  status: string;
  startDate: string | null;
  completionDate: string | null;
}

export interface OverviewPayoutInput {
  id: string;
  /** Net, post-profit-split amount the trader received (PayoutDTO.traderReceived). */
  traderReceived: number;
  status: string;
  paidDate: string | null;
  approvedDate: string | null;
}

export interface OverviewAccountInput {
  accountId: string;
  firmId: string;
  marketCategory: "CFD" | "FUTURES";
  currency: string;
  startingBalance: number;
  /** PropFirmAccountStatus. */
  status: string;
  archivedAt: string | null;
  purchaseDate: string | null;
  createdAt: string;
  stages: OverviewStageInput[];
  /** Raw account-ledger events (signed amounts), any order. */
  ledgerEvents: RawBalanceEvent[];
  payouts: OverviewPayoutInput[];
}

export interface OverviewWeekPoint {
  /** ISO timestamp of the ISO-week-ending instant (Sunday 23:59:59.999Z). */
  weekEnding: string;
  masterCapital: number;
  cumulativePayouts: number;
  weeklyPayouts: number;
  /** How many eligible master/funded accounts contributed this week. */
  activeAccountCount: number;
}

export interface OverviewSummary {
  openingMasterCapital: number;
  currentMasterCapital: number;
  netMasterCapitalChange: number;
  /** null when opening capital is ≤ 0 (division by zero / meaningless %). */
  masterCapitalGrowthPercent: number | null;
  payoutsReceivedDuringPeriod: number;
  lifetimeCumulativePayouts: number;
}

export interface OverviewSeries {
  currency: string;
  /** Every distinct account currency present before currency-filtering — the
   *  UI must not silently add unlike currencies (spec §3). */
  currencies: string[];
  points: OverviewWeekPoint[];
  summary: OverviewSummary;
  hasData: boolean;
}

export interface BuildOverviewOptions {
  from?: string | null;
  to?: string | null;
  /** Restrict to one currency. Omitted → the currency with the most eligible
   *  accounts is used and `currencies` reports the rest. */
  currency?: string;
  /** Payout statuses that count. Default: PAID only. */
  payoutStatuses?: string[];
  /** Test seam — "now" for the timeline's right edge. */
  now?: Date;
}

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;
const DEFAULT_PAYOUT_STATUSES = ["PAID"];

function round2(v: Decimal.Value): number {
  return new Decimal(v).toDecimalPlaces(2, Decimal.ROUND_HALF_UP).toNumber();
}

function parseMs(iso: string | null | undefined): number | null {
  if (!iso) return null;
  const ms = new Date(iso).getTime();
  return Number.isFinite(ms) ? ms : null;
}

/** The Sunday 23:59:59.999Z that closes the ISO week containing `ms` (UTC). */
function isoWeekEndUtc(ms: number): number {
  const d = new Date(ms);
  const dow = d.getUTCDay(); // 0=Sun … 6=Sat
  const daysToSunday = dow === 0 ? 0 : 7 - dow;
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + daysToSunday, 23, 59, 59, 999);
}

interface EligibleAccount {
  input: OverviewAccountInput;
  fundedFromMs: number;
  eligibleUntilMs: number | null;
  balancePoints: { ms: number; balance: number }[];
}

const REACHED_STAGE_STATUSES = ["ACTIVE", "PASSED", "BREACHED", "FAILED", "ABANDONED", "ARCHIVED"];

/** The date an account became a master/funded account, or null if it never
 *  did — a challenge/evaluation account, or one whose funded stage is still
 *  PENDING (created up-front but not yet reached), is not counted. */
function fundedFromMs(a: OverviewAccountInput): number | null {
  // A funded stage that has actually been entered carries a real startDate.
  const fundedStageStarts = a.stages
    .filter(
      (s) =>
        isFundedStageType(s.type as StageTypeLike) &&
        s.startDate != null &&
        REACHED_STAGE_STATUSES.includes(s.status),
    )
    .map((s) => parseMs(s.startDate))
    .filter((ms): ms is number => ms != null);
  if (fundedStageStarts.length > 0) return Math.min(...fundedStageStarts);

  // FUNDED account status but incomplete stage data — best-effort fallback.
  if (a.status === "FUNDED") return parseMs(a.purchaseDate) ?? parseMs(a.createdAt);
  return null;
}

/** The date an eligible account stopped counting (closure / breach / archival),
 *  or null while it is still live. */
function eligibleUntilMs(a: OverviewAccountInput, lastLedgerMs: number | null): number | null {
  const archived = parseMs(a.archivedAt);
  if (archived != null) return archived;

  if (a.status === "BREACHED" || a.status === "FAILED" || a.status === "ARCHIVED") {
    const terminalStage = a.stages
      .filter((s) => ["BREACHED", "FAILED", "ABANDONED"].includes(s.status))
      .map((s) => parseMs(s.completionDate) ?? parseMs(s.startDate))
      .filter((ms): ms is number => ms != null);
    if (terminalStage.length > 0) return Math.max(...terminalStage);
    // No recorded end — it stopped when its ledger activity stopped.
    return lastLedgerMs;
  }
  return null;
}

/** Balance of one account as of `ms` — the last running-balance point at or
 *  before that instant, else the starting balance. */
function balanceAsOf(points: { ms: number; balance: number }[], startingBalance: number, ms: number): number {
  let value = startingBalance;
  for (const p of points) {
    if (p.ms <= ms) value = p.balance;
    else break;
  }
  return value;
}

export function overviewCurrencies(accounts: OverviewAccountInput[]): string[] {
  return [...new Set(accounts.map((a) => a.currency || "USD"))].sort();
}

/** Adapt firm DTOs + a per-account raw-ledger-event map into overview input.
 *  Server-safe (pure data shaping) so page components can build it before
 *  passing to the client chart. */
export function buildOverviewAccountInputs(
  firms: UserPropFirmDTO[],
  ledgerEventsByAccount: ReadonlyMap<string, RawBalanceEvent[]>,
): OverviewAccountInput[] {
  return firms.flatMap((firm) =>
    firm.accounts.map((a) => ({
      accountId: a.id,
      firmId: firm.id,
      marketCategory: a.marketCategory,
      currency: a.accountCurrency || "USD",
      startingBalance: a.startingBalance,
      status: a.status,
      archivedAt: a.archivedAt,
      purchaseDate: a.purchaseDate,
      createdAt: a.createdAt,
      stages: a.stages.map((s) => ({
        type: s.type,
        status: s.status,
        startDate: s.startDate,
        completionDate: s.completionDate,
      })),
      ledgerEvents: ledgerEventsByAccount.get(a.id) ?? [],
      payouts: a.payouts.map((p) => ({
        id: p.id,
        traderReceived: p.traderReceived,
        status: p.status,
        paidDate: p.paidDate,
        approvedDate: p.approvedDate,
      })),
    })),
  );
}

/**
 * Build the weekly Master-Capital + Cumulative-Payouts series for a set of
 * accounts, restricted to one currency and (optionally) a date window.
 */
export function buildOverviewSeries(
  accounts: OverviewAccountInput[],
  options: BuildOverviewOptions = {},
): OverviewSeries {
  const now = options.now ?? new Date();
  const payoutStatuses = new Set((options.payoutStatuses ?? DEFAULT_PAYOUT_STATUSES).map((s) => s.toUpperCase()));
  const currencies = overviewCurrencies(accounts);

  // Currency: explicit, else the one backing the most accounts.
  const currency =
    options.currency ??
    (() => {
      const counts = new Map<string, number>();
      for (const a of accounts) counts.set(a.currency || "USD", (counts.get(a.currency || "USD") ?? 0) + 1);
      return [...counts.entries()].sort((x, y) => y[1] - x[1])[0]?.[0] ?? "USD";
    })();

  const scoped = accounts.filter((a) => (a.currency || "USD") === currency);

  const empty: OverviewSeries = {
    currency,
    currencies,
    points: [],
    summary: {
      openingMasterCapital: 0,
      currentMasterCapital: 0,
      netMasterCapitalChange: 0,
      masterCapitalGrowthPercent: null,
      payoutsReceivedDuringPeriod: 0,
      lifetimeCumulativePayouts: 0,
    },
    hasData: false,
  };
  if (scoped.length === 0) return empty;

  // ── Per-account eligibility + running-balance series ──────────────────────
  const eligible: EligibleAccount[] = [];
  for (const input of scoped) {
    const from = fundedFromMs(input);
    if (from == null) continue; // never a master/funded account → never counted

    const series = buildAccountBalanceSeries(input.ledgerEvents, input.startingBalance);
    const balancePoints = series.points
      .filter((p) => !p.synthetic)
      .map((p) => ({ ms: new Date(p.timestamp).getTime(), balance: p.balance }))
      .sort((a, b) => a.ms - b.ms);
    const lastLedgerMs = balancePoints.length > 0 ? balancePoints[balancePoints.length - 1].ms : null;

    eligible.push({
      input,
      fundedFromMs: from,
      eligibleUntilMs: eligibleUntilMs(input, lastLedgerMs),
      balancePoints,
    });
  }

  // ── Deduped, in-scope payouts on the timeline ────────────────────────────
  const seenPayouts = new Set<string>();
  const payoutEvents: { ms: number; amount: number }[] = [];
  for (const a of scoped) {
    for (const p of a.payouts) {
      if (seenPayouts.has(p.id)) continue;
      seenPayouts.add(p.id);
      if (!payoutStatuses.has(p.status.toUpperCase())) continue;
      const ms = parseMs(p.paidDate) ?? parseMs(p.approvedDate);
      const amount = Number(p.traderReceived);
      if (ms == null || !Number.isFinite(amount)) continue;
      payoutEvents.push({ ms, amount });
    }
  }
  payoutEvents.sort((a, b) => a.ms - b.ms);

  if (eligible.length === 0 && payoutEvents.length === 0) return empty;

  // ── Weekly timeline (UTC ISO week-ending) ────────────────────────────────
  const starts = [
    ...eligible.map((e) => e.fundedFromMs),
    ...payoutEvents.map((p) => p.ms),
  ];
  const ends = [
    ...eligible.map((e) => e.eligibleUntilMs ?? now.getTime()),
    ...payoutEvents.map((p) => p.ms),
    now.getTime(),
  ];
  const firstWeek = isoWeekEndUtc(Math.min(...starts));
  const lastWeek = isoWeekEndUtc(Math.max(...ends));

  const allPoints: OverviewWeekPoint[] = [];
  let cumulative = new Decimal(0);
  let payoutCursor = 0;

  for (let weekEnd = firstWeek; weekEnd <= lastWeek; weekEnd += WEEK_MS) {
    const weekStart = weekEnd - WEEK_MS;

    let weekly = new Decimal(0);
    while (payoutCursor < payoutEvents.length && payoutEvents[payoutCursor].ms <= weekEnd) {
      weekly = weekly.plus(payoutEvents[payoutCursor].amount);
      payoutCursor += 1;
    }
    cumulative = cumulative.plus(weekly);

    let masterCapital = new Decimal(0);
    let activeAccountCount = 0;
    for (const e of eligible) {
      if (e.fundedFromMs > weekEnd) continue;
      if (e.eligibleUntilMs != null && e.eligibleUntilMs < weekStart) continue;
      masterCapital = masterCapital.plus(balanceAsOf(e.balancePoints, e.input.startingBalance, weekEnd));
      activeAccountCount += 1;
    }

    allPoints.push({
      weekEnding: new Date(weekEnd).toISOString(),
      masterCapital: round2(masterCapital),
      cumulativePayouts: round2(cumulative),
      weeklyPayouts: round2(weekly),
      activeAccountCount,
    });
  }

  const lifetimeCumulativePayouts = allPoints.length > 0 ? allPoints[allPoints.length - 1].cumulativePayouts : 0;

  // ── Slice to the visible window (values stay absolute) ───────────────────
  const fromMs = parseMs(options.from) ?? Number.NEGATIVE_INFINITY;
  const toMs = options.to ? new Date(options.to).getTime() + 24 * 60 * 60 * 1000 - 1 : Number.POSITIVE_INFINITY;

  let firstVisibleIdx = allPoints.findIndex((p) => new Date(p.weekEnding).getTime() >= fromMs);
  if (firstVisibleIdx < 0) firstVisibleIdx = allPoints.length;
  const visible = allPoints.filter((p) => {
    const ms = new Date(p.weekEnding).getTime();
    return ms >= fromMs && ms <= toMs;
  });

  const openingPoint =
    firstVisibleIdx > 0 ? allPoints[firstVisibleIdx - 1] : visible[0] ?? allPoints[allPoints.length - 1] ?? null;
  const currentPoint = visible[visible.length - 1] ?? openingPoint;

  const openingMasterCapital = openingPoint?.masterCapital ?? 0;
  const currentMasterCapital = currentPoint?.masterCapital ?? 0;
  const netMasterCapitalChange = round2(new Decimal(currentMasterCapital).minus(openingMasterCapital));
  const payoutsReceivedDuringPeriod = round2(
    visible.reduce((sum, p) => sum.plus(p.weeklyPayouts), new Decimal(0)),
  );

  return {
    currency,
    currencies,
    points: visible,
    summary: {
      openingMasterCapital,
      currentMasterCapital,
      netMasterCapitalChange,
      masterCapitalGrowthPercent:
        openingMasterCapital > 0
          ? round2(new Decimal(netMasterCapitalChange).dividedBy(openingMasterCapital).times(100))
          : null,
      payoutsReceivedDuringPeriod,
      lifetimeCumulativePayouts,
    },
    hasData: visible.length > 0,
  };
}
