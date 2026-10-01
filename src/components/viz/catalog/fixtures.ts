// Deterministic synthetic data for the dev-only viz catalog (/dev/viz).
// NEVER imported by product code — it exists so every chart can be reviewed
// against realistic shapes (drawdowns, losing streaks, many strategies)
// without depending on whatever happens to be in the dev database.

function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function addDays(key: string, n: number): string {
  const d = new Date(`${key}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

export interface FixtureTrade {
  id: string;
  dateKey: string;
  r: number;
  pnl: number;
  strategy: string;
  session: string;
  asset: string;
  direction: "Long" | "Short";
  weekday: number;
  hour: number;
  mood: number;
}

export const FIXTURE_STRATEGIES = ["London Breakout", "NY Reversal", "Asia Range", "Trend Pullback", "Liquidity Sweep", "News Fade", "Opening Drive"];
const SESSIONS = ["Asia", "London", "New York", "Overlap"];
const ASSETS = ["EURUSD", "XAUUSD", "NQ", "GBPUSD", "ES"];

export function fixtureTrades(count = 84, seed = 7): FixtureTrade[] {
  const rand = rng(seed);
  const trades: FixtureTrade[] = [];
  let day = "2026-04-01";
  for (let i = 0; i < count; i++) {
    day = addDays(day, rand() < 0.55 ? 1 : rand() < 0.8 ? 2 : 3);
    const wd = new Date(`${day}T00:00:00Z`).getUTCDay();
    if (wd === 0 || wd === 6) day = addDays(day, wd === 6 ? 2 : 1);
    const strategy = FIXTURE_STRATEGIES[Math.floor(rand() ** 1.6 * FIXTURE_STRATEGIES.length)];
    const edge = strategy === "News Fade" ? -0.15 : strategy === "London Breakout" ? 0.25 : 0.08;
    // A losing streak in the middle so drawdown visuals have something to show.
    const slump = i > 34 && i < 48 ? -0.45 : 0;
    const win = rand() < 0.47 + edge + slump;
    const r = win ? Number((0.8 + rand() * 2.4).toFixed(2)) : rand() < 0.12 ? 0 : Number((-(0.4 + rand() * 0.75)).toFixed(2));
    trades.push({
      id: `t${i}`,
      dateKey: day,
      r,
      pnl: Math.round(r * 500),
      strategy,
      session: SESSIONS[Math.floor(rand() * SESSIONS.length)],
      asset: ASSETS[Math.floor(rand() * ASSETS.length)],
      direction: rand() < 0.55 ? "Long" : "Short",
      weekday: new Date(`${day}T00:00:00Z`).getUTCDay(),
      hour: 2 + Math.floor(rand() * 18),
      mood: 1 + Math.floor(rand() * 5),
    });
  }
  return trades;
}

export function cumulativeR(trades: FixtureTrade[]) {
  let c = 0;
  return trades.map((t) => ({ dateKey: t.dateKey, tradeId: t.id, r: t.r, cumulativeR: Number((c += t.r).toFixed(2)) }));
}

export function balanceCurve(trades: FixtureTrade[], start = 100_000) {
  let bal = start;
  let peak = start;
  return trades.map((t) => {
    bal += t.pnl;
    peak = Math.max(peak, bal);
    const amount = peak - bal;
    return { dateKey: t.dateKey, balance: bal, peak, drawdownAmount: amount, drawdownPercent: peak > 0 ? (amount / peak) * 100 : 0 };
  });
}

export function percentCurve(trades: FixtureTrade[]) {
  const byDay = new Map<string, number>();
  for (const t of trades) byDay.set(t.dateKey, (byDay.get(t.dateKey) ?? 0) + t.r * 0.5);
  let add = 0;
  let comp = 1;
  return [...byDay.entries()].map(([dateKey, pct]) => {
    add += pct;
    comp *= 1 + pct / 100;
    return { dateKey, cumulativeAdditive: Number(add.toFixed(3)), cumulativeCompounding: Number(((comp - 1) * 100).toFixed(3)) };
  });
}

export function dailyPercents(trades: FixtureTrade[]) {
  const byDay = new Map<string, number>();
  for (const t of trades) byDay.set(t.dateKey, (byDay.get(t.dateKey) ?? 0) + t.r * 0.5);
  return [...byDay.entries()].map(([dateKey, percent]) => ({ dateKey, percent: Number(percent.toFixed(2)) }));
}

export function finalizedRCurve(trades: FixtureTrade[]) {
  let c = 0;
  let peak = 0;
  return trades.map((t, i) => {
    c = Number((c + t.r).toFixed(2));
    peak = Math.max(peak, c);
    return { index: i + 1, dateKey: t.dateKey, tradeId: t.id, r: t.r, cumulativeR: c, peakR: peak, drawdownR: Number((c - peak).toFixed(2)) };
  });
}

/** Prop-firm ledger events: an opening balance, trade P&L, fees and one payout. */
export function balanceEvents(trades: FixtureTrade[], start = 50_000) {
  const events: { id: string; eventType: string; amount: number; occurredAt: string; sourceType: string; sourceId: string; reason: string | null }[] = [
    { id: "open", eventType: "ACCOUNT_INITIALIZED", amount: start, occurredAt: `${trades[0].dateKey}T08:00:00.000Z`, sourceType: "ACCOUNT_INIT", sourceId: "acc", reason: null },
  ];
  trades.slice(0, 60).forEach((t, i) => {
    events.push({ id: `e${i}`, eventType: "TRADE_PNL", amount: Math.round(t.r * 250), occurredAt: `${t.dateKey}T${String(8 + (i % 8)).padStart(2, "0")}:30:00.000Z`, sourceType: "TRADE", sourceId: t.id, reason: null });
    if (i === 40) events.push({ id: "payout", eventType: "PAYOUT", amount: -2500, occurredAt: `${t.dateKey}T20:00:00.000Z`, sourceType: "PAYOUT", sourceId: "p1", reason: "First payout" });
  });
  return events;
}

/** Two funded prop-firm accounts with ledgers and payouts, for the overview chart. */
export function overviewAccounts(trades: FixtureTrade[]) {
  const mk = (id: string, start: number, offset: number, payoutAt: number[]) => {
    const slice = trades.slice(offset, offset + 50);
    const events = balanceEvents(slice, start).filter((e) => e.eventType !== "PAYOUT");
    return {
      accountId: id,
      firmId: "firm",
      marketCategory: "FUTURES" as const,
      currency: "USD",
      startingBalance: start,
      status: "FUNDED",
      archivedAt: null,
      purchaseDate: `${slice[0].dateKey}T08:00:00.000Z`,
      createdAt: `${slice[0].dateKey}T08:00:00.000Z`,
      stages: [{ type: "MASTER_FUNDED", status: "ACTIVE", startDate: `${slice[0].dateKey}T08:00:00.000Z`, completionDate: null }],
      ledgerEvents: events,
      payouts: payoutAt.map((i, n) => ({
        id: `${id}-p${n}`,
        traderReceived: 1500 + n * 700,
        status: "PAID",
        paidDate: `${slice[i].dateKey}T18:00:00.000Z`,
        approvedDate: `${slice[i].dateKey}T12:00:00.000Z`,
      })),
    };
  };
  return [mk("a1", 50_000, 0, [20, 38]), mk("a2", 100_000, 18, [30])];
}

function stats(key: string, label: string, list: FixtureTrade[]) {
  const n = list.length;
  const totalR = Number(list.reduce((s, t) => s + t.r, 0).toFixed(2));
  const wins = list.filter((t) => t.r > 0);
  const losses = list.filter((t) => t.r < 0);
  const grossW = wins.reduce((s, t) => s + t.r, 0);
  const grossL = -losses.reduce((s, t) => s + t.r, 0);
  return {
    key,
    label,
    count: n,
    finalizedCount: n,
    totalR,
    averageR: n ? totalR / n : null,
    winRate: n ? (wins.length / n) * 100 : null,
    expectancy: n ? totalR / n : null,
    profitFactor: grossL > 0 ? grossW / grossL : null,
    totalPnl: list.reduce((s, t) => s + t.pnl, 0),
  };
}

export function groupBy(trades: FixtureTrade[], keyOf: (t: FixtureTrade) => string, order?: string[]) {
  const map = new Map<string, FixtureTrade[]>();
  for (const t of trades) map.set(keyOf(t), [...(map.get(keyOf(t)) ?? []), t]);
  const keys = order ?? [...map.keys()];
  return keys.map((k) => stats(k, k, map.get(k) ?? []));
}

export function rBuckets(trades: FixtureTrade[]) {
  const B = [
    { label: "≤ −3R", min: -Infinity, max: -3 },
    { label: "−3…−2R", min: -3, max: -2 },
    { label: "−2…−1R", min: -2, max: -1 },
    { label: "−1…0R", min: -1, max: 0 },
    { label: "0…1R", min: 0, max: 1 },
    { label: "1…2R", min: 1, max: 2 },
    { label: "2…3R", min: 2, max: 3 },
    { label: "≥ 3R", min: 3, max: Infinity },
  ];
  return B.map((b) => ({ ...b, count: trades.filter((t) => t.r >= b.min && t.r < b.max).length }));
}

export function hours(trades: FixtureTrade[]) {
  const map = new Map<number, FixtureTrade[]>();
  for (const t of trades) map.set(t.hour, [...(map.get(t.hour) ?? []), t]);
  return [...map.entries()].sort((a, b) => a[0] - b[0]).map(([hour, list]) => {
    const n = list.length;
    const totalR = list.reduce((s, t) => s + t.r, 0);
    return { hour, trades: n, netPnl: list.reduce((s, t) => s + t.pnl, 0), winRate: (list.filter((t) => t.r > 0).length / n) * 100, avgR: totalR / n, expectancy: totalR / n };
  });
}
