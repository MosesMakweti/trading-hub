/**
 * Chart workspace model — everything about how the trader's screen is laid
 * out, persisted per user (ChartWorkspace, key "sim"). Validated with zod on
 * the server before it is stored, and again on load (an old/corrupt document
 * falls back to defaults field by field instead of breaking the terminal).
 *
 * Nothing here affects trading: panels, chart types, indicators and scripts
 * are views over candles the account has already revealed.
 */
import { z } from "zod";

import { CHART_TYPES, type ChartTypeKey } from "@/domain/indicators/chart-types";
import { INDICATOR_BY_ID, sanitizeInputs } from "@/domain/indicators/catalog";
import { REPLAY_TIMEFRAMES, type ReplayTimeframe } from "@/domain/native-replay/timeframes";
import { isValidTimeZone } from "./sessions";

export const CHART_LAYOUTS = [
  { key: "1", label: "Single chart", charts: 1 },
  { key: "2h", label: "Two side by side", charts: 2 },
  { key: "2v", label: "Two stacked", charts: 2 },
  { key: "3", label: "One large + two", charts: 3 },
  { key: "4", label: "Grid of four", charts: 4 },
] as const;
export type ChartLayoutKey = (typeof CHART_LAYOUTS)[number]["key"];

const tf = z.enum(REPLAY_TIMEFRAMES as unknown as [ReplayTimeframe, ...ReplayTimeframe[]]);
const chartType = z.enum(CHART_TYPES.map((c) => c.key) as [ChartTypeKey, ...ChartTypeKey[]]);
const uid = z.string().min(1).max(40);
const hex = z.string().regex(/^#[0-9a-fA-F]{6}([0-9a-fA-F]{2})?$/);

const indicatorStudy = z.object({
  uid,
  kind: z.literal("indicator"),
  id: z.string().max(40).refine((v) => INDICATOR_BY_ID.has(v), "Unknown indicator."),
  inputs: z.record(z.string().max(40), z.union([z.number(), z.string().max(40)])).default({}),
  visible: z.boolean().default(true),
});
const scriptStudy = z.object({
  uid,
  kind: z.literal("script"),
  scriptId: z.string().min(1).max(64),
  inputs: z.record(z.string().max(120), z.union([z.number(), z.string().max(200), z.boolean()])).default({}),
  visible: z.boolean().default(true),
});
export const studySchema = z.discriminatedUnion("kind", [indicatorStudy, scriptStudy]);
export type ChartStudy = z.infer<typeof studySchema>;

export const chartConfigSchema = z.object({
  /** null = the terminal's selected instrument. */
  symbol: z.string().max(20).nullable().default(null),
  timeframe: tf.default("M15"),
  chartType: chartType.default("candles"),
  /** Box size / reversal / lines for synthetic types; null = automatic. */
  chartParam: z.number().positive().max(1e9).nullable().default(null),
  studies: z.array(studySchema).max(12).default([]),
});
export type ChartConfig = z.infer<typeof chartConfigSchema>;

export const chartSettingsSchema = z.object({
  grid: z.boolean().default(true),
  crosshair: z.enum(["normal", "magnet", "hidden"]).default("normal"),
  priceScale: z.enum(["normal", "log", "percent", "indexed"]).default("normal"),
  showVolume: z.boolean().default(false),
  showLegend: z.boolean().default(true),
  showLastPrice: z.boolean().default(true),
  upColor: hex.nullable().default(null),
  downColor: hex.nullable().default(null),
});
export type ChartSettings = z.infer<typeof chartSettingsSchema>;

export const panelsSchema = z.object({
  left: z.object({ visible: z.boolean().default(true) }).prefault({}),
  right: z.object({ visible: z.boolean().default(true), width: z.number().int().min(240).max(560).default(304) }).prefault({}),
  bottom: z.object({ visible: z.boolean().default(true), height: z.number().int().min(120).max(640).default(224) }).prefault({}),
});
export type Panels = z.infer<typeof panelsSchema>;

/** Playback intervals the data supports: MT5 M1 bars → whole minutes only (no ticks / seconds). */
export const PLAYBACK_TIMEFRAMES = ["M1", "M2", "M3", "M5", "M10", "M15", "M30", "H1"] as const satisfies readonly ReplayTimeframe[];
export type PlaybackTimeframe = (typeof PLAYBACK_TIMEFRAMES)[number];

/** Milliseconds between consecutive playback bars. */
export const PLAYBACK_SPEEDS_MS = [100, 250, 500, 750, 1000, 2000, 3000, 5000, 10000] as const;
export const MIN_SPEED_MS = 50;
export const MAX_SPEED_MS = 60_000;

export const replayBarSchema = z.object({
  mode: z.enum(["floating", "top", "bottom"]).default("floating"),
  /** Floating position as fractions of the free space in the chart area (survives resizes). */
  x: z.number().min(0).max(1).default(0.5),
  y: z.number().min(0).max(1).default(0.9),
  pinned: z.boolean().default(false),
  collapsed: z.boolean().default(false),
  visible: z.boolean().default(true),
});
export type ReplayBarSettings = z.infer<typeof replayBarSchema>;

export const replaySettingsSchema = z.object({
  playbackTf: z.enum(PLAYBACK_TIMEFRAMES).default("M1"),
  speedMs: z.number().int().min(MIN_SPEED_MS).max(MAX_SPEED_MS).default(500),
  bar: replayBarSchema.prefault({}),
});
export type ReplaySettings = z.infer<typeof replaySettingsSchema>;

export const sessionSettingsSchema = z.object({
  /** The time zone the market data's wall clock is in (MT5 servers: usually GMT+2/+3 on New York close). */
  dataTimeZone: z.string().max(64).refine(isValidTimeZone, "Unknown time zone.").default("NYC+7"),
  /** Session ids drawn on the charts (built-in ids or custom session ids). */
  show: z.array(z.string().max(64)).max(20).default([]),
  shading: z.boolean().default(true),
  highLow: z.boolean().default(true),
  labels: z.boolean().default(true),
  /** Last session used in the navigator. */
  selected: z.string().max(64).default("london"),
});
export type SessionSettings = z.infer<typeof sessionSettingsSchema>;

export const presetSchema = z.object({ name: z.string().trim().min(1).max(40), panels: panelsSchema, layout: z.enum(CHART_LAYOUTS.map((l) => l.key) as [ChartLayoutKey, ...ChartLayoutKey[]]) });
export type WorkspacePreset = z.infer<typeof presetSchema>;

export const workspaceSchema = z.object({
  version: z.literal(1).default(1),
  panels: panelsSchema.prefault({}),
  focus: z.boolean().default(false),
  layout: z.enum(CHART_LAYOUTS.map((l) => l.key) as [ChartLayoutKey, ...ChartLayoutKey[]]).default("1"),
  charts: z.array(chartConfigSchema).min(1).max(4).default([{ symbol: null, timeframe: "M15", chartType: "candles", chartParam: null, studies: [] }]),
  activeChart: z.number().int().min(0).max(3).default(0),
  sync: z.object({ symbol: z.boolean().default(false), timeframe: z.boolean().default(false), crosshair: z.boolean().default(true), time: z.boolean().default(false) }).prefault({}),
  favoriteTimeframes: z.array(tf).max(16).default(["M1", "M5", "M15", "H1", "H4", "D1"]),
  settings: chartSettingsSchema.prefault({}),
  presets: z.array(presetSchema).max(12).default([]),
  replay: replaySettingsSchema.prefault({}),
  sessions: sessionSettingsSchema.prefault({}),
});
export type Workspace = z.infer<typeof workspaceSchema>;

export const DEFAULT_WORKSPACE: Workspace = workspaceSchema.parse({});

/** Built-in panel presets (user presets are saved alongside them). */
export const BUILTIN_PRESETS: WorkspacePreset[] = [
  { name: "Trading", layout: "1", panels: DEFAULT_WORKSPACE.panels },
  { name: "Analysis", layout: "2h", panels: { left: { visible: true }, right: { visible: false, width: 304 }, bottom: { visible: false, height: 224 } } },
  { name: "Review", layout: "1", panels: { left: { visible: false }, right: { visible: true, width: 304 }, bottom: { visible: true, height: 360 } } },
];

/**
 * Parses a stored/received workspace leniently: each top-level field that
 * fails validation falls back to its default instead of discarding the
 * whole document. Indicator inputs are clamped to their definitions.
 */
export function normalizeWorkspace(raw: unknown): Workspace {
  const obj = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const out: Record<string, unknown> = {};
  const shape = workspaceSchema.shape;
  for (const key of Object.keys(shape) as (keyof typeof shape)[]) {
    const r = shape[key].safeParse(obj[key]);
    if (r.success) out[key] = r.data;
  }
  const ws = workspaceSchema.parse(out);
  const needed = CHART_LAYOUTS.find((l) => l.key === ws.layout)!.charts;
  while (ws.charts.length < needed) ws.charts.push({ ...ws.charts[0], studies: [] });
  ws.activeChart = Math.min(ws.activeChart, needed - 1);
  for (const c of ws.charts) {
    for (const s of c.studies) if (s.kind === "indicator") s.inputs = sanitizeInputs(INDICATOR_BY_ID.get(s.id)!, s.inputs);
    const seen = new Set<string>();
    c.studies = c.studies.filter((s) => !seen.has(s.uid) && !!seen.add(s.uid));
  }
  return ws;
}

/** Number of charts a layout shows. */
export function chartsFor(layout: ChartLayoutKey): number {
  return CHART_LAYOUTS.find((l) => l.key === layout)!.charts;
}

/** Applies a symbol/timeframe change to one chart, and to all when synced. */
export function applyToCharts(ws: Workspace, index: number, patch: Partial<Pick<ChartConfig, "symbol" | "timeframe">>): Workspace {
  const charts = ws.charts.map((c, i) => {
    const p: Partial<ChartConfig> = {};
    if (patch.symbol !== undefined && (i === index || ws.sync.symbol)) p.symbol = patch.symbol;
    if (patch.timeframe !== undefined && (i === index || ws.sync.timeframe)) p.timeframe = patch.timeframe;
    return { ...c, ...p };
  });
  return { ...ws, charts };
}

export function newUid(): string {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
}
