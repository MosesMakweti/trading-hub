/**
 * Native Replay — canvas rendering of chart drawings (called from the series
 * primitive every frame, in media/CSS-pixel coordinates).
 *
 * Every shape is projected from market coordinates (time, price) at draw time,
 * so zoom/pan/resize/timeframe changes need no stored pixels.
 */
import { channelLines, computePosition, fibExtensionLevels, fibLevels, formatDuration, lineSegment, linearRegression, measure, pitchforkLines, type Pt } from "@/domain/native-replay/drawings/geometry";
import { DEFAULT_FIB_EXT_LEVELS, DEFAULT_FIB_LEVELS, type Anchor, type ChartDrawing } from "@/domain/native-replay/drawings/model";

export interface DrawView {
  width: number;
  height: number;
  timeToX: (t: number) => number | null;
  priceToY: (p: number) => number | null;
  /** Bars between two times on the current timeframe (for the ruler). */
  barsBetween: (a: number, b: number) => number | null;
  /** Revealed candles (time, close) between two times, inclusive — for the regression channel. */
  closesBetween: (a: number, b: number) => { time: number; close: number }[];
  priceScale: number;
  pipSize: number | null;
  dark: boolean;
}

export interface DrawState {
  drawings: readonly ChartDrawing[];
  selectedId: string | null;
  hoverId: string | null;
  /** The drawing being created (not yet committed). */
  draft: ChartDrawing | null;
}

const FONT = "11px ui-sans-serif, system-ui, -apple-system, sans-serif";
const HANDLE_R = 3.5;

function rgba(hex: string, alpha: number): string {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
}

function pt(view: DrawView, a: Anchor): Pt | null {
  const x = view.timeToX(a.time);
  const y = view.priceToY(a.price);
  return x == null || y == null ? null : { x, y };
}

function applyStroke(ctx: CanvasRenderingContext2D, d: ChartDrawing, emphasis: boolean) {
  ctx.strokeStyle = rgba(d.style.color, d.style.opacity);
  ctx.lineWidth = d.style.width + (emphasis ? 0.5 : 0);
  ctx.setLineDash(d.style.dash === "dashed" ? [6, 4] : d.style.dash === "dotted" ? [1.5, 3] : []);
  ctx.lineCap = "round";
}

function line(ctx: CanvasRenderingContext2D, a: Pt, b: Pt) {
  ctx.beginPath();
  ctx.moveTo(a.x, a.y);
  ctx.lineTo(b.x, b.y);
  ctx.stroke();
}

function handle(ctx: CanvasRenderingContext2D, p: Pt, color: string, dark: boolean) {
  ctx.setLineDash([]);
  ctx.beginPath();
  ctx.arc(p.x, p.y, HANDLE_R, 0, Math.PI * 2);
  ctx.fillStyle = dark ? "#16171a" : "#ffffff";
  ctx.fill();
  ctx.lineWidth = 1.5;
  ctx.strokeStyle = color;
  ctx.stroke();
}

function label(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, view: DrawView, opts: { color?: string; align?: CanvasTextAlign; bg?: string } = {}) {
  ctx.font = FONT;
  ctx.setLineDash([]);
  const w = ctx.measureText(text).width + 8;
  const h = 16;
  const left = opts.align === "right" ? x - w : opts.align === "center" ? x - w / 2 : x;
  ctx.fillStyle = opts.bg ?? (view.dark ? "rgba(22, 23, 26, 0.85)" : "rgba(255, 255, 255, 0.9)");
  ctx.fillRect(left, y - h / 2, w, h);
  ctx.fillStyle = opts.color ?? (view.dark ? "#d0d3da" : "#30333a");
  ctx.textBaseline = "middle";
  ctx.textAlign = "left";
  ctx.fillText(text, left + 4, y + 0.5);
}

const fmt = (v: number, scale: number) => v.toFixed(scale);
const signed = (v: number, scale: number) => `${v >= 0 ? "+" : "−"}${Math.abs(v).toFixed(scale)}`;

function drawOne(ctx: CanvasRenderingContext2D, d: ChartDrawing, view: DrawView, selected: boolean, hovered: boolean) {
  const emphasis = selected || hovered;
  // Label text colours with enough contrast on each theme's label background.
  const GOOD = view.dark ? "#6fc3a8" : "#1f6b54";
  const BAD = view.dark ? "#e08b85" : "#9c3b35";
  const handles: Pt[] = [];
  const W = view.width;
  const H = view.height;
  applyStroke(ctx, d, emphasis);

  switch (d.type) {
    case "TREND":
    case "RAY":
    case "EXTENDED":
    case "ARROW": {
      const a = pt(view, d.anchors[0]);
      const b = pt(view, d.anchors[1]);
      if (!a || !b) return;
      const [s, e] = lineSegment(a, b, d.type === "RAY" ? "ray" : d.type === "EXTENDED" ? "extended" : "segment", W, H);
      line(ctx, s, e);
      if (d.type === "ARROW") {
        const ang = Math.atan2(b.y - a.y, b.x - a.x);
        const len = 9 + d.style.width * 2;
        ctx.setLineDash([]);
        ctx.beginPath();
        ctx.moveTo(b.x, b.y);
        ctx.lineTo(b.x - len * Math.cos(ang - 0.45), b.y - len * Math.sin(ang - 0.45));
        ctx.moveTo(b.x, b.y);
        ctx.lineTo(b.x - len * Math.cos(ang + 0.45), b.y - len * Math.sin(ang + 0.45));
        ctx.stroke();
      }
      handles.push(a, b);
      break;
    }
    case "HLINE": {
      const y = view.priceToY(d.anchors[0].price);
      if (y == null) return;
      line(ctx, { x: 0, y }, { x: W, y });
      const x = view.timeToX(d.anchors[0].time);
      if (x != null) handles.push({ x: Math.max(8, Math.min(W - 8, x)), y });
      break;
    }
    case "HRAY": {
      const a = pt(view, d.anchors[0]);
      if (!a) return;
      line(ctx, a, { x: W, y: a.y });
      handles.push(a);
      break;
    }
    case "VLINE": {
      const x = view.timeToX(d.anchors[0].time);
      if (x == null) return;
      line(ctx, { x, y: 0 }, { x, y: H });
      const y = view.priceToY(d.anchors[0].price);
      handles.push({ x, y: y ?? H / 2 });
      break;
    }
    case "RECT": {
      const a = pt(view, d.anchors[0]);
      const b = pt(view, d.anchors[1]);
      if (!a || !b) return;
      ctx.fillStyle = rgba(d.style.color, 0.1 * d.style.opacity + 0.04);
      ctx.fillRect(Math.min(a.x, b.x), Math.min(a.y, b.y), Math.abs(b.x - a.x), Math.abs(b.y - a.y));
      ctx.strokeRect(Math.min(a.x, b.x), Math.min(a.y, b.y), Math.abs(b.x - a.x), Math.abs(b.y - a.y));
      handles.push(a, b, { x: a.x, y: b.y }, { x: b.x, y: a.y });
      break;
    }
    case "CHANNEL": {
      const { main, parallel } = channelLines(d.anchors[0], d.anchors[1], d.anchors[2]);
      const m0 = pt(view, main[0]);
      const m1 = pt(view, main[1]);
      const p0 = pt(view, parallel[0]);
      const p1 = pt(view, parallel[1]);
      if (!m0 || !m1 || !p0 || !p1) return;
      ctx.fillStyle = rgba(d.style.color, 0.08);
      ctx.beginPath();
      ctx.moveTo(m0.x, m0.y);
      ctx.lineTo(m1.x, m1.y);
      ctx.lineTo(p1.x, p1.y);
      ctx.lineTo(p0.x, p0.y);
      ctx.closePath();
      ctx.fill();
      line(ctx, m0, m1);
      line(ctx, p0, p1);
      ctx.setLineDash([4, 4]);
      ctx.lineWidth = 1;
      line(ctx, { x: (m0.x + p0.x) / 2, y: (m0.y + p0.y) / 2 }, { x: (m1.x + p1.x) / 2, y: (m1.y + p1.y) / 2 });
      const c = pt(view, d.anchors[2]); // the parallel line passes through C by construction
      handles.push(m0, m1);
      if (c) handles.push(c);
      break;
    }
    case "TEXT": {
      const a = pt(view, d.anchors[0]);
      if (!a) return;
      ctx.font = "12px ui-sans-serif, system-ui, -apple-system, sans-serif";
      ctx.fillStyle = rgba(d.style.color, d.style.opacity);
      ctx.textBaseline = "bottom";
      ctx.textAlign = "left";
      ctx.fillText(d.data.text || "Note", a.x + 4, a.y - 3);
      handles.push(a);
      break;
    }
    case "PRICE_LABEL": {
      const a = pt(view, d.anchors[0]);
      if (!a) return;
      label(ctx, fmt(d.anchors[0].price, view.priceScale), a.x + 6, a.y - 10, view, { bg: rgba(d.style.color, 0.85), color: "#101114" });
      ctx.setLineDash([]);
      line(ctx, a, { x: a.x + 6, y: a.y - 10 });
      handles.push(a);
      break;
    }
    case "RULER": {
      const a = pt(view, d.anchors[0]);
      const b = pt(view, d.anchors[1]);
      if (!a || !b) return;
      const m = measure(d.anchors[0], d.anchors[1], view.priceScale, { pipSize: view.pipSize, bars: view.barsBetween(d.anchors[0].time, d.anchors[1].time) });
      const up = m.priceChange >= 0;
      ctx.fillStyle = up ? "rgba(79, 157, 134, 0.12)" : "rgba(196, 101, 95, 0.12)";
      ctx.fillRect(Math.min(a.x, b.x), Math.min(a.y, b.y), Math.abs(b.x - a.x), Math.abs(b.y - a.y));
      line(ctx, a, b);
      const text = `${signed(m.priceChange, view.priceScale)} (${m.percentChange >= 0 ? "+" : ""}${m.percentChange}%) · ${Math.abs(m.points)} pts${m.pips != null ? ` · ${Math.abs(m.pips)} pips` : ""} · ${formatDuration(m.minutes)}${m.bars != null ? ` · ${m.bars} bars` : ""}`;
      label(ctx, text, b.x, b.y + (up ? -14 : 14), view, { align: "center", color: up ? GOOD : BAD });
      handles.push(a, b);
      break;
    }
    case "FIB": {
      const a = pt(view, d.anchors[0]);
      const b = pt(view, d.anchors[1]);
      if (!a || !b) return;
      const x0 = Math.min(a.x, b.x);
      const x1 = Math.max(Math.max(a.x, b.x), x0 + 60);
      ctx.setLineDash([]);
      for (const lv of fibLevels(d.anchors[0], d.anchors[1], d.data.levels ?? DEFAULT_FIB_LEVELS, view.priceScale)) {
        const y = view.priceToY(lv.price);
        if (y == null) continue;
        ctx.globalAlpha = lv.level === 0 || lv.level === 1 ? 1 : 0.75;
        line(ctx, { x: x0, y }, { x: x1, y });
        ctx.globalAlpha = 1;
        label(ctx, `${lv.level} (${fmt(lv.price, view.priceScale)})`, x0 + 2, y - 9, view, { color: d.style.color, bg: "rgba(0,0,0,0)" });
      }
      ctx.setLineDash([3, 3]);
      ctx.lineWidth = 1;
      line(ctx, a, b);
      handles.push(a, b);
      break;
    }
    case "FIB_EXT": {
      const [a, b, c] = d.anchors.map((x) => pt(view, x));
      if (!a || !b || !c) return;
      ctx.setLineDash([3, 3]);
      ctx.lineWidth = 1;
      line(ctx, a, b);
      line(ctx, b, c);
      ctx.setLineDash([]);
      const x0 = c.x;
      const x1 = Math.max(c.x + 80, Math.max(a.x, b.x, c.x) + 40);
      for (const lv of fibExtensionLevels(d.anchors[0], d.anchors[1], d.anchors[2], d.data.levels ?? DEFAULT_FIB_EXT_LEVELS, view.priceScale)) {
        const y = view.priceToY(lv.price);
        if (y == null) continue;
        ctx.globalAlpha = lv.level === 0 || lv.level === 1 ? 1 : 0.75;
        line(ctx, { x: x0, y }, { x: x1, y });
        ctx.globalAlpha = 1;
        label(ctx, `${lv.level} (${fmt(lv.price, view.priceScale)})`, x0 + 2, y - 9, view, { color: d.style.color, bg: "rgba(0,0,0,0)" });
      }
      handles.push(a, b, c);
      break;
    }
    case "PITCHFORK": {
      const [a, b, c] = d.anchors.map((x) => pt(view, x));
      if (!a || !b || !c) return;
      const { median, upper, lower } = pitchforkLines(d.anchors[0], d.anchors[1], d.anchors[2]);
      const ray = (l: [Anchor, Anchor]) => {
        const p0 = pt(view, l[0]);
        const p1 = pt(view, l[1]);
        if (!p0 || !p1) return;
        const [s0, e0] = lineSegment(p0, p1, "ray", W, H);
        line(ctx, s0, e0);
      };
      ray(median);
      ray(upper);
      ray(lower);
      ctx.setLineDash([3, 3]);
      ctx.lineWidth = 1;
      line(ctx, b, c);
      handles.push(a, b, c);
      break;
    }
    case "TRIANGLE": {
      const [a, b, c] = d.anchors.map((x) => pt(view, x));
      if (!a || !b || !c) return;
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.lineTo(c.x, c.y);
      ctx.closePath();
      ctx.fillStyle = rgba(d.style.color, 0.1 * d.style.opacity + 0.04);
      ctx.fill();
      ctx.stroke();
      handles.push(a, b, c);
      break;
    }
    case "ELLIPSE": {
      const a = pt(view, d.anchors[0]);
      const b = pt(view, d.anchors[1]);
      if (!a || !b) return;
      ctx.beginPath();
      ctx.ellipse((a.x + b.x) / 2, (a.y + b.y) / 2, Math.abs(b.x - a.x) / 2, Math.abs(b.y - a.y) / 2, 0, 0, Math.PI * 2);
      ctx.fillStyle = rgba(d.style.color, 0.1 * d.style.opacity + 0.04);
      ctx.fill();
      ctx.stroke();
      handles.push(a, b);
      break;
    }
    case "DATE_RANGE":
    case "PRICE_RANGE": {
      const a = pt(view, d.anchors[0]);
      const b = pt(view, d.anchors[1]);
      if (!a || !b) return;
      const dateRange = d.type === "DATE_RANGE";
      const m = measure(d.anchors[0], d.anchors[1], view.priceScale, { pipSize: view.pipSize, bars: view.barsBetween(d.anchors[0].time, d.anchors[1].time) });
      ctx.fillStyle = rgba(d.style.color, 0.12);
      if (dateRange) {
        ctx.fillRect(Math.min(a.x, b.x), 0, Math.abs(b.x - a.x), H);
        line(ctx, { x: a.x, y: 0 }, { x: a.x, y: H });
        line(ctx, { x: b.x, y: 0 }, { x: b.x, y: H });
        ctx.setLineDash([]);
        line(ctx, { x: a.x, y: (a.y + b.y) / 2 }, { x: b.x, y: (a.y + b.y) / 2 });
        label(ctx, `${m.bars != null ? `${m.bars} bars · ` : ""}${formatDuration(m.minutes)}`, (a.x + b.x) / 2, (a.y + b.y) / 2 - 12, view, { align: "center" });
      } else {
        ctx.fillRect(0, Math.min(a.y, b.y), W, Math.abs(b.y - a.y));
        line(ctx, { x: 0, y: a.y }, { x: W, y: a.y });
        line(ctx, { x: 0, y: b.y }, { x: W, y: b.y });
        ctx.setLineDash([]);
        line(ctx, { x: (a.x + b.x) / 2, y: a.y }, { x: (a.x + b.x) / 2, y: b.y });
        label(ctx, `${signed(m.priceChange, view.priceScale)} (${m.percentChange >= 0 ? "+" : ""}${m.percentChange}%) · ${Math.abs(m.points)} pts${m.pips != null ? ` · ${Math.abs(m.pips)} pips` : ""}`, (a.x + b.x) / 2, Math.min(a.y, b.y) - 12, view, { align: "center", color: m.priceChange >= 0 ? GOOD : BAD });
      }
      handles.push(a, b);
      break;
    }
    case "REGRESSION": {
      const t0 = Math.min(d.anchors[0].time, d.anchors[1].time);
      const t1 = Math.max(d.anchors[0].time, d.anchors[1].time);
      const pts = view.closesBetween(t0, t1);
      const reg = linearRegression(pts.map((q) => q.close));
      const a = pt(view, d.anchors[0]);
      const b = pt(view, d.anchors[1]);
      if (!reg || pts.length < 2) {
        if (a && b) {
          ctx.setLineDash([3, 3]);
          line(ctx, a, b);
          label(ctx, "Needs at least 2 revealed candles", (a.x + b.x) / 2, Math.min(a.y, b.y) - 12, view, { align: "center" });
          handles.push(a, b);
        }
        break;
      }
      const n = pts.length - 1;
      const xs = view.timeToX(pts[0].time);
      const xe = view.timeToX(pts[n].time);
      if (xs == null || xe == null) return;
      const at = (i: number, off: number) => view.priceToY(reg.intercept + reg.slope * i + off);
      const dev = 2 * reg.stdev;
      for (const [off, dash] of [[0, [6, 4]], [dev, []], [-dev, []]] as const) {
        const y0 = at(0, off);
        const y1 = at(n, off);
        if (y0 == null || y1 == null) continue;
        ctx.setLineDash(dash as unknown as number[]);
        line(ctx, { x: xs, y: y0 }, { x: xe, y: y1 });
      }
      const up0 = at(0, dev), up1 = at(n, dev), lo0 = at(0, -dev), lo1 = at(n, -dev);
      if (up0 != null && up1 != null && lo0 != null && lo1 != null) {
        ctx.fillStyle = rgba(d.style.color, 0.08);
        ctx.beginPath();
        ctx.moveTo(xs, up0);
        ctx.lineTo(xe, up1);
        ctx.lineTo(xe, lo1);
        ctx.lineTo(xs, lo0);
        ctx.closePath();
        ctx.fill();
      }
      const yl = at(n, dev);
      if (yl != null) label(ctx, `Regression · ${pts.length} bars · ±2σ`, xe, yl - 12, view, { align: "right", color: d.style.color, bg: "rgba(0,0,0,0)" });
      if (a) handles.push(a);
      if (b) handles.push(b);
      break;
    }
    case "CROSS": {
      const x = view.timeToX(d.anchors[0].time);
      const y = view.priceToY(d.anchors[0].price);
      if (x == null || y == null) return;
      line(ctx, { x: 0, y }, { x: W, y });
      line(ctx, { x, y: 0 }, { x, y: H });
      handles.push({ x, y });
      break;
    }
    case "LONG":
    case "SHORT": {
      const p = d.data.position;
      if (!p) return;
      const x0 = view.timeToX(d.anchors[0].time);
      const x1 = view.timeToX(d.anchors[1].time);
      const yE = view.priceToY(p.entry);
      const yS = view.priceToY(p.stop);
      if (x0 == null || x1 == null || yE == null || yS == null) return;
      const left = Math.min(x0, x1);
      const right = Math.max(x0, x1, left + 40);
      const calc = computePosition(d.type, p, view.priceScale, view.pipSize);
      const lastTarget = p.targets[p.targets.length - 1];
      const yT = view.priceToY(lastTarget) ?? yE;
      ctx.setLineDash([]);
      ctx.fillStyle = "rgba(79, 157, 134, 0.16)";
      ctx.fillRect(left, Math.min(yE, yT), right - left, Math.abs(yT - yE));
      ctx.fillStyle = "rgba(196, 101, 95, 0.16)";
      ctx.fillRect(left, Math.min(yE, yS), right - left, Math.abs(yS - yE));
      ctx.lineWidth = 1;
      ctx.strokeStyle = "rgba(160, 165, 175, 0.9)";
      line(ctx, { x: left, y: yE }, { x: right, y: yE });
      ctx.strokeStyle = "#c4655f";
      line(ctx, { x: left, y: yS }, { x: right, y: yS });
      ctx.strokeStyle = "#4f9d86";
      p.targets.forEach((t, i) => {
        const y = view.priceToY(t);
        if (y == null) return;
        line(ctx, { x: left, y }, { x: right, y });
        const c = calc.targets[i];
        label(ctx, `TP${i + 1} ${fmt(t, view.priceScale)} · ${signed(c.reward, view.priceScale)} (${Math.abs(c.points)} pts${c.pips != null ? `, ${Math.abs(c.pips)} pips` : ""})${c.rr != null ? ` · ${c.rr}R` : ""}`, right - 2, y + (d.type === "LONG" ? -10 : 10), view, { align: "right", color: GOOD });
        handles.push({ x: right, y });
      });
      label(ctx, `SL ${fmt(p.stop, view.priceScale)} · −${fmt(calc.risk, view.priceScale)} (${calc.riskPoints} pts${calc.riskPips != null ? `, ${calc.riskPips} pips` : ""}) · 1R`, right - 2, yS + (d.type === "LONG" ? 10 : -10), view, { align: "right", color: BAD });
      const head = calc.valid
        ? `${d.type === "LONG" ? "Long" : "Short"} ${fmt(p.entry, view.priceScale)} · R:R 1:${calc.targets[0].rr}${p.targets.length > 1 ? ` … 1:${calc.targets[calc.targets.length - 1].rr}` : ""}${d.linkedTradeId ? " · in Trade Idea" : ""}${d.data.orderRef ? ` · ${d.data.orderRef.status === "FILLED" ? "executed" : "order placed"}` : ""}`
        : `Invalid: ${calc.issues[0]}`;
      label(ctx, head, left + 2, yE + (d.type === "LONG" ? 10 : -10), view, { color: calc.valid ? undefined : BAD });
      handles.push({ x: right, y: yE }, { x: right, y: yS }, { x: left, y: yE });
      break;
    }
  }

  if (selected) for (const h of handles) handle(ctx, h, d.style.color, view.dark);
}

export function renderDrawings(ctx: CanvasRenderingContext2D, state: DrawState, view: DrawView): void {
  ctx.save();
  for (const d of state.drawings) {
    if (d.hidden || d.id === state.draft?.id) continue;
    drawOne(ctx, d, view, d.id === state.selectedId, d.id === state.hoverId);
  }
  if (state.draft) drawOne(ctx, state.draft, view, true, false);
  ctx.restore();
}
