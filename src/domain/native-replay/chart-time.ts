/**
 * Native Replay — the ONLY bridge between dataset wall-clock minutes and the
 * chart library's time values.
 *
 * The chart (lightweight-charts) takes UTC-second timestamps and renders them
 * as UTC — it has no timezone support by design. We hand it the dataset's
 * wall-clock minute × 60, i.e. "broker time pretending to be UTC", and format
 * every label ourselves with integer math (`partsOf`, which uses Date only as
 * a UTC calendar calculator). The browser's timezone is never consulted, so
 * broker 09:17 reads 09:17 in Lusaka, London, New York or Tokyo.
 */
import { partsOf, type WallClockMinute } from "./wall-clock";

/** Seconds, as the chart expects; never a real instant. */
export type ChartTime = number;

export function toChartTime(minute: WallClockMinute): ChartTime {
  return minute * 60;
}

export function fromChartTime(time: ChartTime): WallClockMinute {
  return Math.floor(time / 60);
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const pad = (n: number) => String(n).padStart(2, "0");

/** Kinds of time-axis labels (mirrors the chart library's TickMarkType values 0–4). */
export const TICK = { YEAR: 0, MONTH: 1, DAY_OF_MONTH: 2, TIME: 3, TIME_WITH_SECONDS: 4 } as const;

/** Time-axis label: "2024", "May", "14 May", "09:17". */
export function formatTickMark(time: ChartTime, tickType: number): string {
  const p = partsOf(fromChartTime(time));
  switch (tickType) {
    case TICK.YEAR:
      return String(p.year);
    case TICK.MONTH:
      return MONTHS[p.month - 1];
    case TICK.DAY_OF_MONTH:
      return `${p.day} ${MONTHS[p.month - 1]}`;
    default:
      return `${pad(p.hour)}:${pad(p.minute)}`;
  }
}

/** Crosshair / legend label: "Tue 14 May 2024 09:17". */
export function formatCrosshairTime(time: ChartTime): string {
  const p = partsOf(fromChartTime(time));
  return `${DAYS[p.weekday]} ${p.day} ${MONTHS[p.month - 1]} ${p.year} ${pad(p.hour)}:${pad(p.minute)}`;
}

/** Compact position label for toolbars: "14 May 2024 09:17". */
export function formatReplayTime(minute: WallClockMinute): string {
  const p = partsOf(minute);
  return `${p.day} ${MONTHS[p.month - 1]} ${p.year} ${pad(p.hour)}:${pad(p.minute)}`;
}

/** Price text at the dataset's own precision (never a hardcoded 5 decimals). */
export function formatPrice(price: number, priceScale: number): string {
  return price.toFixed(priceScale);
}
