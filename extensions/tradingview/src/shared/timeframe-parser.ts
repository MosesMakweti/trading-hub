/**
 * Traditorium TradingView Extension — Step 5. Canonical timeframe
 * normalization.
 *
 * CONVERSION RULES (TradingView's own publicly documented Charting Library
 * "resolution" format — https://www.tradingview.com/charting-library-docs/
 * — the same interval strings used in TradingView's own embeddable widget
 * API, not a private/internal representation):
 *
 *   - A BARE NUMBER string is ALWAYS minutes. "1" = 1 minute, "60" = 60
 *     minutes, "240" = 240 minutes. This is the exact rule §6 warns not to
 *     assume without verifying — it is verified against TradingView's own
 *     documented resolution format, not assumed from the numeric value
 *     alone.
 *   - A number followed by "S" is seconds ("1S", "5S", "15S", "30S").
 *   - "D", or a number followed by "D", is days. Bare "D" means 1 day.
 *   - "W" / "<N>W" is weeks. Bare "W" means 1 week.
 *   - "M" / "<N>M" is MONTHS, not minutes — this is the one place a letter
 *     suffix could be confused with a unit, and TradingView's own format
 *     resolves it unambiguously: minutes are NEVER letter-suffixed in this
 *     format, only bare digits are. A trailing "M" always means months.
 *
 * DISPLAY FORM this module produces:
 *   - Minutes < 60, or not evenly divisible by 60: "{n}m" (e.g. "5m", "45m",
 *     "90m" — 90 is kept as minutes rather than a fabricated "1.5h").
 *   - Minutes evenly divisible by 60: "{n/60}h" (e.g. "60"→"1h", "240"→"4h"),
 *     matching TradingView's own toolbar display convention.
 *   - Seconds: "{n}s".
 *   - Days: "{n}D" (bare "D" → "1D").
 *   - Weeks: "{n}W" (bare "W" → "1W").
 *   - Months: "{n}M" (bare "M" → "1M").
 *
 * Unrecognized input returns null — this module never guesses.
 */

const SECONDS = /^(\d+)S$/i;
const DAYS = /^(\d*)D$/i;
const WEEKS = /^(\d*)W$/i;
const MONTHS = /^(\d*)M$/i;
const MINUTES = /^(\d+)$/;

function withDefaultMultiplier(digits: string): number {
  return digits.length === 0 ? 1 : Number.parseInt(digits, 10);
}

export function normalizeTradingViewInterval(raw: string): string | null {
  const trimmed = raw.trim();
  if (trimmed.length === 0) return null;

  const seconds = SECONDS.exec(trimmed);
  if (seconds) return `${seconds[1]}s`;

  const days = DAYS.exec(trimmed);
  if (days) return `${withDefaultMultiplier(days[1]!)}D`;

  const weeks = WEEKS.exec(trimmed);
  if (weeks) return `${withDefaultMultiplier(weeks[1]!)}W`;

  const months = MONTHS.exec(trimmed);
  if (months) return `${withDefaultMultiplier(months[1]!)}M`;

  const minutes = MINUTES.exec(trimmed);
  if (minutes) {
    const n = Number.parseInt(minutes[1]!, 10);
    if (n <= 0) return null;
    return n % 60 === 0 ? `${n / 60}h` : `${n}m`;
  }

  return null;
}
