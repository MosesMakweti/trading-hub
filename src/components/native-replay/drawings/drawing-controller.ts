/**
 * Native Replay — chart drawing controller (imperative, outside React).
 *
 * Owns the drawings of the viewed asset, the active tool, selection, dragging,
 * magnet snapping and the undo/redo history, and renders through one series
 * primitive on the chart canvas. React only hears about selection changes and
 * list changes (not every pointer move), so drawing never re-renders the chart.
 *
 * Coordinates: pointer ↔ market via the chart's time scale (fractional logical
 * index ↔ wall-clock minute, see geometry.ts) and the series' price scale.
 * Anchors are stored as (time, price) — dragging updates those, never pixels.
 *
 * Future safety: magnet snapping only consults the chart's REVEALED candles;
 * over empty space right of the replay position there is nothing to snap to.
 * Drawing geometry may extend there — it is geometry, not market data.
 */
import type { IChartApi, ISeriesApi, ISeriesPrimitive, ISeriesPrimitiveAxisView, IPrimitivePaneRenderer, IPrimitivePaneView, Logical, SeriesAttachedParameter, Time } from "lightweight-charts";

import type { EngineCandle } from "@/domain/native-replay/candle-engine";
import { channelLines, defaultPosition, distanceToSegment, lineSegment, logicalToTime, priceOnLine, timeToLogical, type Pt } from "@/domain/native-replay/drawings/geometry";
import { applyOp, DrawingHistory, type DrawingOp } from "@/domain/native-replay/drawings/history";
import { snapPrice, type SnapCandle } from "@/domain/native-replay/drawings/magnet";
import { DEFAULT_FIB_LEVELS, defaultStyle, storedAnchorCount, TOOLS, type Anchor, type ChartDrawing, type DrawingType } from "@/domain/native-replay/drawings/model";
import { renderDrawings, type DrawView } from "./drawing-renderer";

export interface DrawingControllerCallbacks {
  onSelection: (drawing: ChartDrawing | null) => void;
  onToolChange: (tool: DrawingType | null) => void;
  onListChange: (drawings: ChartDrawing[]) => void;
}

type Part =
  | { kind: "body" }
  | { kind: "anchor"; index: number }
  | { kind: "corner"; time: 0 | 1; price: 0 | 1 }
  | { kind: "level"; level: "entry" | "stop" | number }
  | { kind: "edge"; index: 0 | 1 };

interface Hit {
  drawing: ChartDrawing;
  part: Part;
}

interface Drag {
  hit: Hit;
  before: ChartDrawing;
  startLogical: number;
  startPrice: number;
  moved: boolean;
}

const HANDLE_HIT_PX = 8;
const LINE_HIT_PX = 6;
const MAGNET_PX = 14;

const newId = () => (typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `d${Date.now()}${Math.random().toString(36).slice(2)}`);
const clone = (d: ChartDrawing): ChartDrawing => JSON.parse(JSON.stringify(d));

declare global {
  interface Window {
    __nativeReplayDrawMetrics?: { frames: number; drawMs: number[] };
  }
}

export class DrawingController {
  private chart: IChartApi | null = null;
  private series: ISeriesApi<"Candlestick"> | null = null;
  private container: HTMLElement | null = null;
  private primitive: DrawingsPrimitive | null = null;

  private drawings: ChartDrawing[] = [];
  private history = new DrawingHistory();
  private tool: DrawingType | null = null;
  private magnet = false;
  private readOnly = false;
  private selectedId: string | null = null;
  private hoverId: string | null = null;
  private draft: ChartDrawing | null = null;
  private draftPlaced = 0; // anchors fixed so far while creating
  private drag: Drag | null = null;

  private assetSymbol = "";
  private priceScale = 5;
  private pipSize: number | null = null;
  private tfMinutes = 30;
  private dark = true;
  private times: number[] = [];
  private snapCandles: SnapCandle[] = [];

  /** Persists an edit (create / update / delete) — installed by the host. */
  private commitHandler: (op: DrawingOp) => void = () => {};

  constructor(private readonly cb: DrawingControllerCallbacks) {}

  setCommitHandler(fn: (op: DrawingOp) => void): void {
    this.commitHandler = fn;
  }

  // ── Wiring ───────────────────────────────────────────────────────────────

  attach(chart: IChartApi, series: ISeriesApi<"Candlestick">, container: HTMLElement): void {
    this.detach();
    this.chart = chart;
    this.series = series;
    this.container = container;
    this.primitive = new DrawingsPrimitive(this);
    series.attachPrimitive(this.primitive);
    container.addEventListener("pointerdown", this.onPointerDown, true);
    container.addEventListener("mousedown", this.swallowWhileInteracting, true);
    container.addEventListener("pointermove", this.onHover);
    container.addEventListener("pointerleave", this.onLeave);
    this.applyChartInteraction();
    if (process.env.NODE_ENV !== "production") {
      // Dev-only QA hook: inspect drawings and where market coordinates land on screen.
      (window as unknown as { __nrDraw?: unknown }).__nrDraw = {
        drawings: () => this.drawings,
        selectedId: () => this.selectedId,
        screen: (t: number, p: number) => ({ x: this.timeToX(t), y: this.priceToY(p) }),
        candleTimes: () => this.times,
      };
    }
  }

  detach(): void {
    if (this.series && this.primitive) this.series.detachPrimitive(this.primitive);
    this.container?.removeEventListener("pointerdown", this.onPointerDown, true);
    this.container?.removeEventListener("mousedown", this.swallowWhileInteracting, true);
    this.container?.removeEventListener("pointermove", this.onHover);
    this.container?.removeEventListener("pointerleave", this.onLeave);
    window.removeEventListener("pointermove", this.onDragMove);
    window.removeEventListener("pointerup", this.onDragEnd);
    this.chart = null;
    this.series = null;
    this.container = null;
    this.primitive = null;
  }

  setContext(ctx: { assetSymbol: string; priceScale: number; pipSize: number | null; tfMinutes: number; dark: boolean; readOnly: boolean }): void {
    this.assetSymbol = ctx.assetSymbol;
    this.priceScale = ctx.priceScale;
    this.pipSize = ctx.pipSize;
    this.tfMinutes = ctx.tfMinutes;
    this.dark = ctx.dark;
    if (ctx.readOnly !== this.readOnly) {
      this.readOnly = ctx.readOnly;
      if (this.readOnly) this.setTool(null);
    }
    this.redraw();
  }

  /** The chart's (revealed) candles for the current view — coordinate mapping + magnet. */
  setCandles(candles: readonly EngineCandle[], priceScale: number): void {
    const s = 10 ** priceScale;
    this.times = candles.map((c) => c.time);
    this.snapCandles = candles.map((c) => ({ time: c.time, open: c.open / s, high: c.high / s, low: c.low / s, close: c.close / s }));
    this.redraw();
  }

  /** Server-loaded drawings for the viewed asset (resets history and selection). */
  setDrawings(list: ChartDrawing[]): void {
    this.drawings = list;
    this.history.clear();
    this.cancel();
    this.select(null);
    this.cb.onListChange(this.drawings);
    this.redraw();
  }

  getDrawings(): readonly ChartDrawing[] {
    return this.drawings;
  }

  setTool(tool: DrawingType | null): void {
    if (this.readOnly && tool) return;
    this.cancelDraft();
    this.tool = tool;
    if (tool) this.select(null);
    this.applyChartInteraction();
    this.updateCursor(null);
    this.cb.onToolChange(tool);
  }

  getTool(): DrawingType | null {
    return this.tool;
  }

  setMagnet(on: boolean): void {
    this.magnet = on;
  }

  // ── Selection & edits (toolbar / keyboard) ───────────────────────────────

  select(id: string | null): void {
    if (id === this.selectedId) return;
    this.selectedId = id;
    this.cb.onSelection(this.selected());
    this.redraw();
  }

  selected(): ChartDrawing | null {
    return this.drawings.find((d) => d.id === this.selectedId) ?? null;
  }

  /** Apply an edit made by the trader (records history, persists). */
  private commit(op: DrawingOp): void {
    this.drawings = applyOp(this.drawings, op);
    this.history.record(op);
    this.commitHandler(op);
    this.afterChange();
  }

  private applyHistory(op: DrawingOp | null): void {
    if (!op) return;
    this.drawings = applyOp(this.drawings, op);
    this.commitHandler(op);
    if (op.kind === "delete" && op.drawing.id === this.selectedId) this.selectedId = null;
    this.afterChange();
  }

  private afterChange(): void {
    this.cb.onListChange(this.drawings);
    this.cb.onSelection(this.selected());
    this.redraw();
  }

  update(id: string, mutate: (d: ChartDrawing) => void, options: { allowLocked?: boolean } = {}): void {
    if (this.readOnly) return;
    const before = this.drawings.find((d) => d.id === id);
    if (!before || (before.locked && !options.allowLocked)) return;
    const after = clone(before);
    mutate(after);
    this.commit({ kind: "update", before, after });
  }

  remove(id: string): void {
    if (this.readOnly) return;
    const d = this.drawings.find((x) => x.id === id);
    if (!d) return;
    if (this.selectedId === id) this.selectedId = null;
    this.commit({ kind: "delete", drawing: d });
  }

  deleteSelected(): boolean {
    const d = this.selected();
    if (!d || d.locked || this.readOnly) return false;
    this.remove(d.id);
    return true;
  }

  duplicateSelected(): void {
    const d = this.selected();
    if (!d || this.readOnly) return;
    const copy = clone(d);
    copy.id = newId();
    copy.locked = false;
    copy.linkedTradeId = null;
    // Offset a few bars right so the copy is visible.
    copy.anchors = copy.anchors.map((a) => ({ ...a, time: this.shiftTime(a.time, 3) }));
    this.commit({ kind: "create", drawing: copy });
    this.select(copy.id);
  }

  undo(): void {
    if (this.readOnly) return;
    this.applyHistory(this.history.undo());
  }

  redo(): void {
    if (this.readOnly) return;
    this.applyHistory(this.history.redo());
  }

  canUndo(): boolean {
    return this.history.canUndo();
  }

  /** Esc: cancel a drawing in progress and leave its tool; otherwise deselect. */
  cancel(): void {
    if (this.draft || this.tool) {
      this.cancelDraft();
      this.setTool(null);
    } else {
      this.select(null);
    }
  }

  private cancelDraft(): void {
    this.draft = null;
    this.draftPlaced = 0;
    this.applyChartInteraction();
    this.redraw();
  }

  // ── Coordinates ──────────────────────────────────────────────────────────

  private logicalOf(t: number): number {
    return timeToLogical(this.times, this.tfMinutes, t);
  }

  private shiftTime(t: number, bars: number): number {
    return logicalToTime(this.times, this.tfMinutes, this.logicalOf(t) + bars);
  }

  /**
   * The chart's logical↔coordinate conversions work in WHOLE bars (a fractional
   * index comes back as 0; a coordinate comes back rounded to a bar). Anchors
   * are fractional (09:17 on H1 is bar + 17/60), so interpolate between whole
   * bars ourselves using the local bar spacing.
   */
  private logicalToX(l: number): number | null {
    if (!this.chart) return null;
    const ts = this.chart.timeScale();
    const i = Math.floor(l);
    const x0 = ts.logicalToCoordinate(i as Logical);
    if (x0 == null) return null;
    const x1 = ts.logicalToCoordinate((i + 1) as Logical);
    const spacing = x1 != null ? x1 - x0 : ts.options().barSpacing;
    return x0 + (l - i) * spacing;
  }

  private xToLogical(x: number): number | null {
    if (!this.chart) return null;
    const ts = this.chart.timeScale();
    const i = ts.coordinateToLogical(x);
    if (i == null) return null;
    const whole = Math.round(i);
    const x0 = this.logicalToX(whole);
    const x1 = this.logicalToX(whole + 1);
    if (x0 == null || x1 == null || x1 === x0) return whole;
    return whole + (x - x0) / (x1 - x0);
  }

  timeToX = (t: number): number | null => {
    if (!this.chart || this.times.length === 0) return null;
    return this.logicalToX(this.logicalOf(t));
  };

  priceToY = (p: number): number | null => this.series?.priceToCoordinate(p) ?? null;

  private pointerMarket(e: PointerEvent): { x: number; y: number; logical: number; time: number; price: number } | null {
    if (!this.chart || !this.series || !this.container || this.times.length === 0) return null;
    const rect = this.container.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    if (x > this.chart.timeScale().width()) return null; // over the price axis
    const logical = this.xToLogical(x);
    const rawPrice = this.series.coordinateToPrice(y);
    if (logical == null || rawPrice == null) return null;
    let price = rawPrice as number;
    let time = logicalToTime(this.times, this.tfMinutes, logical);
    if (this.magnet) {
      const snap = snapPrice({ y, candleIndex: Math.round(logical), candles: this.snapCandles, priceToY: this.priceToY, thresholdPx: MAGNET_PX });
      if (snap) {
        price = snap.price;
        time = snap.time;
      }
    }
    return { x, y, logical, time, price: this.roundPrice(price) };
  }

  private roundPrice(p: number): number {
    const s = 10 ** this.priceScale;
    return Math.round(p * s) / s;
  }

  private view(width: number, height: number): DrawView {
    return {
      width,
      height,
      timeToX: this.timeToX,
      priceToY: this.priceToY,
      barsBetween: (a, b) => (this.times.length ? Math.round(Math.abs(this.logicalOf(b) - this.logicalOf(a))) : null),
      priceScale: this.priceScale,
      pipSize: this.pipSize,
      dark: this.dark,
    };
  }

  // ── Rendering ────────────────────────────────────────────────────────────

  redraw(): void {
    this.primitive?.update();
  }

  render(ctx: CanvasRenderingContext2D, size: { width: number; height: number }): void {
    const t0 = performance.now();
    renderDrawings(ctx, { drawings: this.drawings, selectedId: this.selectedId, hoverId: this.hoverId, draft: this.draft }, this.view(size.width, size.height));
    if (process.env.NODE_ENV !== "production") {
      const m = (window.__nativeReplayDrawMetrics ??= { frames: 0, drawMs: [] });
      m.frames += 1;
      m.drawMs.push(performance.now() - t0);
      if (m.drawMs.length > 3000) m.drawMs.shift();
    }
  }

  axisViews(): ISeriesPrimitiveAxisView[] {
    const out: ISeriesPrimitiveAxisView[] = [];
    const add = (price: number, color: string) => {
      const y = this.priceToY(price);
      if (y == null) return;
      out.push({ coordinate: () => y, text: () => price.toFixed(this.priceScale), textColor: () => "#101114", backColor: () => color, visible: () => true, tickVisible: () => true });
    };
    for (const d of this.drawings) {
      if (d.hidden) continue;
      if (d.type === "HLINE" || d.type === "HRAY" || d.type === "PRICE_LABEL") add(d.anchors[0].price, d.style.color);
      if ((d.type === "LONG" || d.type === "SHORT") && d.id === this.selectedId && d.data.position) {
        add(d.data.position.entry, "#a0a5af");
        add(d.data.position.stop, "#c4655f");
        d.data.position.targets.forEach((t) => add(t, "#4f9d86"));
      }
    }
    return out;
  }

  // ── Hit testing ──────────────────────────────────────────────────────────

  private handlesOf(d: ChartDrawing): { p: Pt; part: Part }[] {
    const pt = (a: Anchor): Pt | null => {
      const x = this.timeToX(a.time);
      const y = this.priceToY(a.price);
      return x == null || y == null ? null : { x, y };
    };
    const out: { p: Pt; part: Part }[] = [];
    if (d.type === "LONG" || d.type === "SHORT") {
      const pos = d.data.position;
      const x0 = this.timeToX(d.anchors[0].time);
      const x1 = this.timeToX(d.anchors[1].time);
      if (!pos || x0 == null || x1 == null) return out;
      const left = Math.min(x0, x1);
      const right = Math.max(x0, x1, left + 40);
      const y = (p: number) => this.priceToY(p);
      const push = (py: number | null, part: Part, x = right) => py != null && out.push({ p: { x, y: py }, part });
      push(y(pos.stop), { kind: "level", level: "stop" });
      pos.targets.forEach((t, i) => push(y(t), { kind: "level", level: i }));
      push(y(pos.entry), { kind: "level", level: "entry" });
      push(y(pos.entry), { kind: "edge", index: x0 <= x1 ? 0 : 1 }, left);
      return out;
    }
    if (d.type === "HLINE") {
      const y = this.priceToY(d.anchors[0].price);
      const x = this.timeToX(d.anchors[0].time);
      if (y != null && x != null) out.push({ p: { x, y }, part: { kind: "anchor", index: 0 } });
      return out;
    }
    d.anchors.forEach((a, index) => {
      const p = pt(a);
      if (p) out.push({ p, part: { kind: "anchor", index } });
    });
    if (d.type === "RECT" && out.length === 2) {
      const [a, b] = [out[0].p, out[1].p];
      out.push({ p: { x: a.x, y: b.y }, part: { kind: "corner", time: 0, price: 1 } }, { p: { x: b.x, y: a.y }, part: { kind: "corner", time: 1, price: 0 } });
    }
    return out;
  }

  private bodyDistance(d: ChartDrawing, p: Pt, width: number, height: number): number {
    const pt = (a: Anchor): Pt | null => {
      const x = this.timeToX(a.time);
      const y = this.priceToY(a.price);
      return x == null || y == null ? null : { x, y };
    };
    const a = d.anchors[0] ? pt(d.anchors[0]) : null;
    const b = d.anchors[1] ? pt(d.anchors[1]) : null;
    switch (d.type) {
      case "HLINE": {
        const y = this.priceToY(d.anchors[0].price);
        return y == null ? Infinity : Math.abs(p.y - y);
      }
      case "HRAY":
        return a && p.x >= a.x - LINE_HIT_PX ? Math.abs(p.y - a.y) : Infinity;
      case "VLINE": {
        const x = this.timeToX(d.anchors[0].time);
        return x == null ? Infinity : Math.abs(p.x - x);
      }
      case "TREND":
      case "ARROW":
      case "RAY":
      case "EXTENDED":
      case "RULER": {
        if (!a || !b) return Infinity;
        const [s, e] = lineSegment(a, b, d.type === "RAY" ? "ray" : d.type === "EXTENDED" ? "extended" : "segment", width, height);
        return distanceToSegment(p, s, e);
      }
      case "RECT":
      case "FIB": {
        if (!a || !b) return Infinity;
        const inside = p.x >= Math.min(a.x, b.x) && p.x <= Math.max(a.x, b.x, Math.min(a.x, b.x) + 60) && p.y >= Math.min(a.y, b.y) && p.y <= Math.max(a.y, b.y);
        return inside ? 0 : Infinity;
      }
      case "CHANNEL": {
        const { main, parallel } = channelLines(d.anchors[0], d.anchors[1], d.anchors[2]);
        const segs = [main, parallel].map(([m, n]) => [pt(m), pt(n)] as const);
        let best = Infinity;
        for (const [m, n] of segs) if (m && n) best = Math.min(best, distanceToSegment(p, m, n));
        // Between the lines counts as the body too.
        const t = logicalToTime(this.times, this.tfMinutes, this.xToLogical(p.x) ?? 0);
        const y1 = this.priceToY(priceOnLine(main[0], main[1], t));
        const y2 = this.priceToY(priceOnLine(parallel[0], parallel[1], t));
        const x0 = this.timeToX(Math.min(main[0].time, main[1].time));
        const x1 = this.timeToX(Math.max(main[0].time, main[1].time));
        if (y1 != null && y2 != null && x0 != null && x1 != null && p.x >= x0 && p.x <= x1 && p.y >= Math.min(y1, y2) && p.y <= Math.max(y1, y2)) best = 0;
        return best;
      }
      case "TEXT":
      case "PRICE_LABEL":
        return a && p.x >= a.x - 4 && p.x <= a.x + 90 && p.y >= a.y - 24 && p.y <= a.y + 6 ? 0 : Infinity;
      case "LONG":
      case "SHORT": {
        const pos = d.data.position;
        const x0 = this.timeToX(d.anchors[0].time);
        const x1 = this.timeToX(d.anchors[1].time);
        if (!pos || x0 == null || x1 == null) return Infinity;
        const ys = [pos.entry, pos.stop, ...pos.targets].map((v) => this.priceToY(v)).filter((v): v is number => v != null);
        const left = Math.min(x0, x1);
        const right = Math.max(x0, x1, left + 40);
        return p.x >= left && p.x <= right && p.y >= Math.min(...ys) && p.y <= Math.max(...ys) ? 0 : Infinity;
      }
    }
  }

  /** Screen area of a drawing's filled interior (for hit priority), or null for line-like drawings. */
  private areaOf(d: ChartDrawing): number | null {
    if (!["RECT", "FIB", "CHANNEL", "LONG", "SHORT", "TEXT", "PRICE_LABEL"].includes(d.type)) return null;
    const pts = d.anchors.map((a) => ({ x: this.timeToX(a.time), y: this.priceToY(a.price) }));
    const ys = d.data.position ? [d.data.position.entry, d.data.position.stop, ...d.data.position.targets].map((v) => this.priceToY(v)) : pts.map((q) => q.y);
    const xs = pts.map((q) => q.x).filter((v): v is number => v != null);
    const yy = ys.filter((v): v is number => v != null);
    if (xs.length === 0 || yy.length === 0) return null;
    return Math.max(1, Math.max(...xs) - Math.min(...xs)) * Math.max(1, Math.max(...yy) - Math.min(...yy));
  }

  /**
   * Hit priority: handles of the selected drawing; then lines/edges (topmost
   * first); then filled interiors, smallest first — so a small rectangle
   * inside a large position box is still selectable.
   */
  private hitTest(p: Pt): Hit | null {
    if (!this.chart) return null;
    const width = this.chart.timeScale().width();
    const height = this.container?.clientHeight ?? 0;
    const visible = this.drawings.filter((d) => !d.hidden);
    const sel = visible.find((d) => d.id === this.selectedId);
    if (sel) {
      for (const h of this.handlesOf(sel)) if (Math.hypot(h.p.x - p.x, h.p.y - p.y) <= HANDLE_HIT_PX) return { drawing: sel, part: h.part };
    }
    let bestArea: { d: ChartDrawing; area: number } | null = null;
    for (let i = visible.length - 1; i >= 0; i -= 1) {
      const d = visible[i];
      if (this.bodyDistance(d, p, width, height) > LINE_HIT_PX) continue;
      const area = this.areaOf(d);
      if (area == null) return { drawing: d, part: { kind: "body" } };
      if (!bestArea || area < bestArea.area) bestArea = { d, area };
    }
    return bestArea ? { drawing: bestArea.d, part: { kind: "body" } } : null;
  }

  // ── Pointer interaction ──────────────────────────────────────────────────

  /** While drawing or dragging, the chart must not pan or zoom under the pointer. */
  private applyChartInteraction(): void {
    const busy = this.tool != null || this.drag != null || this.draft != null;
    this.chart?.applyOptions({ handleScroll: !busy, handleScale: !busy });
  }

  private swallowWhileInteracting = (e: MouseEvent) => {
    if (this.tool || this.drag || this.draft) e.stopPropagation();
  };

  private onPointerDown = (e: PointerEvent) => {
    if (e.button !== 0) return;
    const m = this.pointerMarket(e);
    if (!m) return;

    if (this.tool && !this.readOnly) {
      e.stopPropagation();
      e.preventDefault();
      this.placeAnchor(m);
      return;
    }
    const hit = this.hitTest({ x: m.x, y: m.y });
    if (!hit) {
      this.select(null); // let the chart pan
      return;
    }
    this.select(hit.drawing.id);
    if (hit.drawing.locked || this.readOnly) return;
    e.stopPropagation();
    e.preventDefault();
    this.drag = { hit, before: clone(hit.drawing), startLogical: m.logical, startPrice: m.price, moved: false };
    this.applyChartInteraction();
    window.addEventListener("pointermove", this.onDragMove);
    window.addEventListener("pointerup", this.onDragEnd);
  };

  private placeAnchor(m: { logical: number; time: number; price: number }): void {
    const tool = this.tool!;
    const need = TOOLS[tool].anchors;
    const anchor = { time: m.time, price: m.price };
    if (!this.draft) {
      this.draft = this.newDrawing(tool, anchor, m.logical);
      this.draftPlaced = 1;
      if (need === 1) return this.finishDraft();
      this.applyChartInteraction();
      window.addEventListener("pointermove", this.onDraftMove);
      window.addEventListener("pointerup", this.onDraftUp);
      return;
    }
    this.draft.anchors[this.draftPlaced] = anchor;
    this.draftPlaced += 1;
    if (this.draftPlaced >= need) this.finishDraft();
    else this.redraw();
  }

  private onDraftMove = (e: PointerEvent) => {
    if (!this.draft) return;
    const m = this.pointerMarket(e);
    if (!m) return;
    const i = Math.min(this.draftPlaced, storedAnchorCount(this.draft.type) - 1);
    this.draft.anchors[i] = { time: m.time, price: m.price };
    if (this.draft.type === "CHANNEL" && this.draftPlaced === 1) this.draft.anchors[2] = { ...this.draft.anchors[1] };
    this.redraw();
  };

  /** Drag-to-create: releasing after a real drag places the second anchor. */
  private onDraftUp = (e: PointerEvent) => {
    if (!this.draft || this.draftPlaced !== 1) return;
    const m = this.pointerMarket(e);
    if (!m) return;
    const first = this.draft.anchors[0];
    const x0 = this.timeToX(first.time);
    const y0 = this.priceToY(first.price);
    const moved = x0 != null && y0 != null && Math.hypot(m.x - x0, m.y - y0) > 6;
    if (moved) this.placeAnchor(m);
  };

  private finishDraft(): void {
    window.removeEventListener("pointermove", this.onDraftMove);
    window.removeEventListener("pointerup", this.onDraftUp);
    const d = this.draft!;
    this.draft = null;
    this.draftPlaced = 0;
    d.anchors = d.anchors.map((a) => ({ time: a.time, price: this.roundPrice(a.price) }));
    this.tool = null;
    this.cb.onToolChange(null);
    this.applyChartInteraction();
    this.commit({ kind: "create", drawing: d });
    this.select(d.id);
  }

  private newDrawing(type: DrawingType, a: Anchor, logical: number): ChartDrawing {
    const anchors: Anchor[] = Array.from({ length: storedAnchorCount(type) }, () => ({ ...a }));
    const data: ChartDrawing["data"] = {};
    if (type === "FIB") data.levels = [...DEFAULT_FIB_LEVELS];
    if (type === "TEXT") data.text = "Note";
    if (type === "LONG" || type === "SHORT") {
      // Default risk: ~1.5× the average range of the latest revealed candles.
      const recent = this.snapCandles.slice(-20);
      const avgRange = recent.length ? recent.reduce((s, c) => s + (c.high - c.low), 0) / recent.length : a.price * 0.002;
      data.position = defaultPosition(type, a.price, avgRange * 1.5, this.priceScale);
      anchors[1] = { time: logicalToTime(this.times, this.tfMinutes, logical + 25), price: a.price };
    }
    return { id: newId(), type, assetSymbol: this.assetSymbol, anchors, style: defaultStyle(type), data, locked: false, hidden: false, linkedTradeId: null };
  }

  private onDragMove = (e: PointerEvent) => {
    const drag = this.drag;
    if (!drag) return;
    const m = this.pointerMarket(e);
    if (!m) return;
    drag.moved = true;
    const next = clone(drag.before);
    const part = drag.hit.part;
    if (part.kind === "body") {
      const dL = m.logical - drag.startLogical;
      const dP = m.price - drag.startPrice;
      next.anchors = next.anchors.map((a) => ({ time: logicalToTime(this.times, this.tfMinutes, this.logicalOf(a.time) + dL), price: this.roundPrice(a.price + dP) }));
      if (next.data.position) {
        const p = next.data.position;
        next.data.position = { entry: this.roundPrice(p.entry + dP), stop: this.roundPrice(p.stop + dP), targets: p.targets.map((t) => this.roundPrice(t + dP)) };
      }
    } else if (part.kind === "anchor") {
      next.anchors[part.index] = { time: m.time, price: m.price };
    } else if (part.kind === "corner") {
      next.anchors[part.time] = { ...next.anchors[part.time], time: m.time };
      next.anchors[part.price] = { ...next.anchors[part.price], price: m.price };
    } else if (part.kind === "level" && next.data.position) {
      const p = next.data.position;
      if (part.level === "entry") p.entry = m.price;
      else if (part.level === "stop") p.stop = m.price;
      else p.targets[part.level] = m.price;
      next.anchors = next.anchors.map((a) => ({ ...a, price: p.entry }));
    } else if (part.kind === "edge") {
      next.anchors[part.index] = { ...next.anchors[part.index], time: m.time };
    }
    this.drawings = this.drawings.map((d) => (d.id === next.id ? next : d));
    this.redraw();
  };

  private onDragEnd = () => {
    window.removeEventListener("pointermove", this.onDragMove);
    window.removeEventListener("pointerup", this.onDragEnd);
    const drag = this.drag;
    this.drag = null;
    this.applyChartInteraction();
    if (!drag || !drag.moved) return;
    const after = this.drawings.find((d) => d.id === drag.before.id);
    if (after) {
      this.drawings = this.drawings.map((d) => (d.id === after.id ? drag.before : d)); // commit() re-applies
      this.commit({ kind: "update", before: drag.before, after });
    }
  };

  private onHover = (e: PointerEvent) => {
    if (this.drag) return;
    if (this.draft) return this.updateCursor("crosshair");
    const m = this.pointerMarket(e);
    const hit = m && !this.tool ? this.hitTest({ x: m.x, y: m.y }) : null;
    const id = hit?.drawing.id ?? null;
    if (id !== this.hoverId) {
      this.hoverId = id;
      this.redraw();
    }
    this.updateCursor(this.tool ? "crosshair" : hit ? (hit.drawing.locked || this.readOnly ? "pointer" : hit.part.kind === "body" ? "move" : "grab") : null);
  };

  private onLeave = () => {
    if (this.hoverId) {
      this.hoverId = null;
      this.redraw();
    }
  };

  private updateCursor(cursor: string | null): void {
    if (this.container) this.container.style.cursor = cursor ?? (this.tool ? "crosshair" : "");
  }
}

/** The series primitive: one canvas pane view drawing every drawing, plus price-axis labels. */
class DrawingsPrimitive implements ISeriesPrimitive<Time> {
  private requestUpdate: (() => void) | null = null;
  private readonly paneView: IPrimitivePaneView;

  constructor(private readonly controller: DrawingController) {
    const renderer: IPrimitivePaneRenderer = {
      draw: (target) => target.useMediaCoordinateSpace(({ context, mediaSize }) => controller.render(context, mediaSize)),
    };
    this.paneView = { renderer: () => renderer, zOrder: () => "top" };
  }

  attached(param: SeriesAttachedParameter<Time>): void {
    this.requestUpdate = param.requestUpdate;
  }

  detached(): void {
    this.requestUpdate = null;
  }

  update(): void {
    this.requestUpdate?.();
  }

  paneViews(): readonly IPrimitivePaneView[] {
    return [this.paneView];
  }

  priceAxisViews(): readonly ISeriesPrimitiveAxisView[] {
    return this.controller.axisViews();
  }
}
