/**
 * Native Replay — chart drawing model (pure; shared by the chart, the server
 * and the tests).
 *
 * A drawing lives in MARKET coordinates, never screen pixels: every anchor is
 * a wall-clock minute (dataset/server clock) plus a price. That is what lets a
 * drawing survive zoom, pan, resize, timeframe switches and reloads — the
 * chart maps anchors to pixels on every frame. Drawings belong to a Backtest
 * Run + asset; they are not owned by a timeframe (an anchor at 09:17 sits 17
 * minutes into the 09:00 H1 candle).
 *
 * Geometry may extend into empty space right of the replay position (a ray,
 * a projected trend line, a position box). That is drawing, not market data:
 * nothing about a drawing ever reveals a candle after the replay position.
 */

export const DRAWING_TYPES = [
  "TREND",
  "HLINE",
  "HRAY",
  "VLINE",
  "RAY",
  "EXTENDED",
  "RECT",
  "CHANNEL",
  "TEXT",
  "ARROW",
  "PRICE_LABEL",
  "RULER",
  "FIB",
  "LONG",
  "SHORT",
] as const;

export type DrawingType = (typeof DRAWING_TYPES)[number];

export interface Anchor {
  /** Wall-clock minute on the dataset's clock (may be after the replay position — geometry only). */
  time: number;
  price: number;
}

export type LineDash = "solid" | "dashed" | "dotted";

export interface DrawingStyle {
  color: string; // #rrggbb
  width: 1 | 2 | 3 | 4;
  dash: LineDash;
  opacity: number; // 0.1–1
}

export interface PositionData {
  entry: number;
  stop: number;
  /** TP1, TP2, … — never a single hardcoded target. */
  targets: number[];
}

export interface DrawingData {
  text?: string;
  /** Fibonacci ratios (defaults when absent) — custom levels later need no rewrite. */
  levels?: number[];
  position?: PositionData;
}

export interface ChartDrawing {
  id: string;
  type: DrawingType;
  assetSymbol: string;
  anchors: Anchor[];
  style: DrawingStyle;
  data: DrawingData;
  locked: boolean;
  hidden: boolean;
  /** Set once the drawing was used to create a Trade Idea (drawing → plan, never the reverse). */
  linkedTradeId: string | null;
}

export interface ToolMeta {
  label: string;
  anchors: number; // anchors placed by the trader
  shortcut?: string; // shown in tooltips (Alt + key)
  group: "lines" | "shapes" | "fib" | "annotate" | "measure" | "trade";
}

export const TOOLS: Record<DrawingType, ToolMeta> = {
  TREND: { label: "Trend line", anchors: 2, shortcut: "Alt+T", group: "lines" },
  HLINE: { label: "Horizontal line", anchors: 1, shortcut: "Alt+H", group: "lines" },
  HRAY: { label: "Horizontal ray", anchors: 1, shortcut: "Alt+J", group: "lines" },
  VLINE: { label: "Vertical line", anchors: 1, shortcut: "Alt+V", group: "lines" },
  RAY: { label: "Ray", anchors: 2, group: "lines" },
  EXTENDED: { label: "Extended line", anchors: 2, group: "lines" },
  RECT: { label: "Rectangle", anchors: 2, shortcut: "Alt+R", group: "shapes" },
  CHANNEL: { label: "Parallel channel", anchors: 3, group: "shapes" },
  TEXT: { label: "Text note", anchors: 1, shortcut: "Alt+N", group: "annotate" },
  ARROW: { label: "Arrow", anchors: 2, group: "annotate" },
  PRICE_LABEL: { label: "Price label", anchors: 1, group: "annotate" },
  RULER: { label: "Measure", anchors: 2, shortcut: "Alt+M", group: "measure" },
  FIB: { label: "Fibonacci retracement", anchors: 2, shortcut: "Alt+F", group: "fib" },
  LONG: { label: "Long position", anchors: 1, shortcut: "Alt+L", group: "trade" },
  SHORT: { label: "Short position", anchors: 1, shortcut: "Alt+S", group: "trade" },
};

/** Stored anchor count per type (positions keep a left/right time span). */
export function storedAnchorCount(type: DrawingType): number {
  return type === "LONG" || type === "SHORT" ? 2 : TOOLS[type].anchors;
}

export const DEFAULT_FIB_LEVELS = [0, 0.236, 0.382, 0.5, 0.618, 0.786, 1];

/** Restrained palette (hex — the chart's canvas parser rejects CSS Color 4). */
export const DRAWING_COLORS = ["#8ab4f8", "#e0b35b", "#c4655f", "#4f9d86", "#b39ddb", "#d0d3da"] as const;

export function defaultStyle(type: DrawingType): DrawingStyle {
  if (type === "RECT") return { color: "#8ab4f8", width: 1, dash: "solid", opacity: 0.9 };
  if (type === "FIB") return { color: "#e0b35b", width: 1, dash: "solid", opacity: 0.9 };
  if (type === "RULER") return { color: "#d0d3da", width: 1, dash: "dashed", opacity: 0.9 };
  return { color: "#8ab4f8", width: 2, dash: "solid", opacity: 1 };
}

export const MAX_TEXT_LENGTH = 280;
export const MAX_TARGETS = 5;
export const MAX_DRAWINGS_PER_ASSET = 500;

/** Structural validation shared by the client (before saving) and the server (authoritative). */
export function validateDrawing(d: Pick<ChartDrawing, "type" | "anchors" | "style" | "data">): string[] {
  const issues: string[] = [];
  if (!(DRAWING_TYPES as readonly string[]).includes(d.type)) return ["Unknown drawing type."];
  if (d.anchors.length !== storedAnchorCount(d.type)) issues.push(`${TOOLS[d.type].label} needs ${storedAnchorCount(d.type)} anchor(s).`);
  for (const a of d.anchors) {
    if (!Number.isInteger(a.time) || a.time < 0 || a.time > 100_000_000) issues.push("Invalid anchor time.");
    if (!Number.isFinite(a.price) || a.price <= 0 || a.price > 1e9) issues.push("Invalid anchor price.");
  }
  if (!/^#[0-9a-fA-F]{6}$/.test(d.style.color)) issues.push("Invalid colour.");
  if (![1, 2, 3, 4].includes(d.style.width)) issues.push("Invalid line width.");
  if (!["solid", "dashed", "dotted"].includes(d.style.dash)) issues.push("Invalid line style.");
  if (!(d.style.opacity >= 0.1 && d.style.opacity <= 1)) issues.push("Invalid opacity.");
  if (d.data.text != null && d.data.text.length > MAX_TEXT_LENGTH) issues.push("Text is too long.");
  if (d.data.levels && (d.data.levels.length > 20 || d.data.levels.some((l) => !Number.isFinite(l) || l < -5 || l > 5))) issues.push("Invalid Fibonacci levels.");
  if (d.type === "LONG" || d.type === "SHORT") {
    const p = d.data.position;
    if (!p) issues.push("A position needs entry, stop and target.");
    else {
      if (![p.entry, p.stop, ...p.targets].every((x) => Number.isFinite(x) && x > 0)) issues.push("Invalid position prices.");
      if (p.targets.length < 1 || p.targets.length > MAX_TARGETS) issues.push(`A position has 1–${MAX_TARGETS} targets.`);
    }
  }
  return issues;
}
