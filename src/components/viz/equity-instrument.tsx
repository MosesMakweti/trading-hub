"use client";

import { useId, useMemo } from "react";
import {
  Area,
  AreaChart,
  CartesianGrid,
  ComposedChart,
  Line,
  ReferenceArea,
  ReferenceDot,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import { rechartsTooltip, type TooltipRow } from "@/components/viz/chart-tooltip";
import { daySpan, formatDateLong, formatDateTick, formatPct, formatTick, formatValue, type ValueUnit } from "@/components/viz/format";
import { annotateSeries, baselineOffset, extent, niceTicks, paddedDomain, timeTickIndices, type AnnotatedPoint, type SeriesSummary } from "@/components/viz/series";
import { CHART, VIZ } from "@/components/viz/tokens";

export interface EquityPoint {
  /** dateKey (YYYY-MM-DD). Several points may share a date (one per trade). */
  x: string;
  value: number;
  /** The single step's own contribution when known (e.g. a trade's realized R). */
  stepValue?: number;
  /** Extra context line for the tooltip (e.g. asset · strategy). */
  note?: string;
}

export interface EquityReference {
  label: string;
  /** Aligned 1:1 with `points` (same length and order). */
  values: (number | null)[];
}

type Row = AnnotatedPoint & {
  /** The synthetic opening point at the baseline (display only). */
  origin?: boolean;
  stepValue?: number;
  note?: string;
  ref: number | null;
  /** −fromPeak, for the drawdown pane. */
  under: number;
  underPct: number | null;
};

/**
 * EquityInstrument — the primary equity curve, built to be read like an
 * instrument rather than a picture:
 *  - the line and its wash split at the BASELINE (start balance / 0R): profit
 *    ink above, loss ink below, so "am I up?" is answered by colour + position;
 *  - the baseline itself is drawn and labelled;
 *  - the period high and the max-drawdown span (peak → trough) are marked;
 *  - every point's tooltip says the level, the step change, the step's own
 *    contribution (e.g. the trade's R), distance from the running peak, and
 *    the reference (expected / process-perfect) gap when one is supplied;
 *  - an optional underwater pane below shares the crosshair (syncId) on its
 *    OWN axis — never a dual-axis chart.
 * Presentation only: it annotates the series it's given, never re-derives it.
 */
export function EquityInstrument({
  points,
  unit,
  baseline = 0,
  baselineLabel = "Start",
  reference,
  height = 300,
  drawdownPane = false,
  drawdownHeight = 88,
  stepLabel = "Step",
  valueLabel = "Equity",
  origin = true,
  xMode = "time",
}: {
  points: EquityPoint[];
  unit: ValueUnit;
  baseline?: number;
  baselineLabel?: string;
  reference?: EquityReference;
  height?: number;
  drawdownPane?: boolean;
  drawdownHeight?: number;
  /** Tooltip label for `stepValue` (e.g. "Trade R"). */
  stepLabel?: string;
  /** Tooltip label for the plotted level (e.g. "Cumulative R", "Balance"). */
  valueLabel?: string;
  /** Draw an opening point at the baseline so the first step is visible
   *  (display only — it adds no value to the series or its summary). */
  origin?: boolean;
  /** "time": ticks on calendar boundaries. "sequence": ticks are trade numbers
   *  (several points per day stay distinct — e.g. simulated-market order). */
  xMode?: "time" | "sequence";
}) {
  const uid = useId().replace(/:/g, "");
  const syncId = `eq-${uid}`;

  const { rows, summary, domain, ticks, strokeOffset, fillOffset, spanDays } = useMemo(() => {
    const withOrigin = origin && points.length > 0;
    const src: (EquityPoint & { origin?: boolean })[] = withOrigin
      ? [{ x: points[0].x, value: baseline, origin: true }, ...points]
      : points;
    const refValues = reference ? (withOrigin ? [baseline, ...reference.values] : reference.values) : null;
    const { points: annotated } = annotateSeries(
      src.map((p) => ({ x: p.x, value: p.value })),
      baseline,
    );
    const { summary } = annotateSeries(points.map((p) => ({ x: p.x, value: p.value })), baseline);
    const rows: Row[] = annotated.map((a, i) => ({
      ...a,
      origin: src[i].origin,
      stepValue: src[i].stepValue,
      note: src[i].note,
      ref: refValues?.[i] ?? null,
      under: -a.fromPeak,
      underPct: a.peak !== 0 && unit === "money" ? -(a.fromPeak / a.peak) * 100 : null,
    }));
    const values = rows.flatMap((r) => (r.ref == null ? [r.value] : [r.value, r.ref]));
    const padded = paddedDomain(values, { include: baseline, pad: 0.04 });
    const { domain, ticks } = niceTicks(padded[0], padded[1], 5);
    // SVG gradients default to objectBoundingBox units, so each split offset
    // is relative to the PATH's own extent: the line spans only its values;
    // the area spans its values plus the baseline it fills to.
    const own = rows.map((r) => r.value);
    const [lineMin, lineMax] = extent(own);
    const [fillMin, fillMax] = extent(own, baseline);
    return {
      rows,
      summary,
      domain,
      ticks,
      strokeOffset: baselineOffset(lineMin, lineMax, baseline),
      fillOffset: baselineOffset(fillMin, fillMax, baseline),
      spanDays: rows.length > 1 ? daySpan(rows[0].x, rows[rows.length - 1].x) : 0,
    };
  }, [points, baseline, reference, unit, origin]);

  const last = rows[rows.length - 1];
  const offsetIdx = rows[0]?.origin ? 1 : 0;
  // Summary indices refer to `points`; shift them onto `rows` (which may lead with the origin).
  const dd = summary?.maxDrawdown
    ? { ...summary.maxDrawdown, peakIndex: summary.maxDrawdown.peakIndex + offsetIdx, troughIndex: summary.maxDrawdown.troughIndex + offsetIdx }
    : null;
  const high = summary ? { index: summary.high.index + offsetIdx, value: summary.high.value } : null;
  const tickX = (i: number) =>
    xMode === "sequence" ? `#${i}` : rows[i] ? formatDateTick(rows[i].x, spanDays) : "";
  const xTicks = useMemo(
    () =>
      xMode === "sequence"
        ? niceTicks(0, Math.max(1, rows.length - 1), 6).ticks.filter((t) => Number.isInteger(t) && t <= rows.length - 1)
        : timeTickIndices(rows.map((r) => r.x)),
    [rows, xMode],
  );
  const underTicks = useMemo(() => {
    const vals = rows.map((r) => (unit === "money" ? (r.underPct ?? 0) : r.under));
    return niceTicks(Math.min(0, ...vals), 0, 3);
  }, [rows, unit]);

  const tooltip = rechartsTooltip<Row>((r) => {
    if (r.origin) {
      return {
        title: formatDateLong(r.x),
        subtitle: "Start of range",
        rows: [{ key: "v", label: baselineLabel, value: formatValue(baseline, unit), color: VIZ.axis }],
      };
    }
    const vsBase = r.value - baseline;
    const out: TooltipRow[] = [
      { key: "v", label: valueLabel, value: formatValue(r.value, unit), color: lineColorFor(vsBase), tone: undefined },
    ];
    if (r.ref != null && reference) {
      out.push({ key: "ref", label: reference.label, value: formatValue(r.ref, unit), color: VIZ.reference, mark: "dash" });
      const gap = r.value - r.ref;
      out.push({ key: "gap", label: "Gap", value: formatValue(gap, unit, { signed: true }), tone: toneOf(gap), mark: "none" });
    }
    out.push({
      key: "chg",
      label: r.index === offsetIdx ? `Change from ${baselineLabel.toLowerCase()}` : "Change",
      value: formatValue(r.change, unit, { signed: true }),
      tone: toneOf(r.change),
      separated: true,
    });
    if (r.stepValue != null) {
      out.push({ key: "step", label: stepLabel, value: formatValue(r.stepValue, unit === "money" ? "money" : unit, { signed: true }), tone: toneOf(r.stepValue) });
    }
    out.push({
      key: "base",
      label: `vs ${baselineLabel.toLowerCase()}`,
      value: formatValue(vsBase, unit, { signed: true }),
      tone: toneOf(vsBase),
    });
    out.push(
      r.fromPeak > 0
        ? {
            key: "dd",
            label: "From peak",
            value: r.underPct != null ? `${formatValue(-r.fromPeak, unit, { signed: true })} · ${formatPct(r.underPct, 1)}` : formatValue(-r.fromPeak, unit, { signed: true }),
            tone: "loss",
          }
        : { key: "dd", label: "From peak", value: r.isNewHigh ? "New high" : "At peak", tone: "muted" },
    );
    return {
      title: xMode === "sequence" ? `Trade ${r.index + 1 - offsetIdx} · ${formatDateLong(r.x)}` : formatDateLong(r.x),
      subtitle: r.note ?? (points.length > 1 ? `${r.index + 1 - offsetIdx} of ${points.length}` : undefined),
      rows: out,
    };
  });

  const xAxis = (
    <XAxis
      dataKey="index"
      type="number"
      domain={[0, Math.max(0, rows.length - 1)]}
      ticks={xTicks}
      tickFormatter={tickX}
      tick={CHART.tick}
      {...CHART.xAxis}
      allowDecimals={false}
      interval="preserveStartEnd"
      minTickGap={20}
    />
  );

  return (
    <div className="space-y-1">
      <ResponsiveContainer width="100%" height={height}>
        <ComposedChart data={rows} syncId={drawdownPane ? syncId : undefined} margin={{ ...CHART.margin, top: 16, right: 28 }}>
          <defs>
            <linearGradient id={`${uid}-stroke`} x1="0" y1="0" x2="0" y2="1">
              <stop offset={strokeOffset} stopColor={VIZ.profit} />
              <stop offset={strokeOffset} stopColor={VIZ.loss} />
            </linearGradient>
            <linearGradient id={`${uid}-fill`} x1="0" y1="0" x2="0" y2="1">
              <stop offset={0} stopColor={VIZ.profit} stopOpacity={0.2} />
              <stop offset={fillOffset} stopColor={VIZ.profit} stopOpacity={0.03} />
              <stop offset={fillOffset} stopColor={VIZ.loss} stopOpacity={0.03} />
              <stop offset={1} stopColor={VIZ.loss} stopOpacity={0.2} />
            </linearGradient>
          </defs>
          <CartesianGrid {...CHART.grid} />
          {xAxis}
          <YAxis
            domain={domain}
            ticks={ticks}
            tickFormatter={(v: number) => formatTick(v, unit)}
            tick={CHART.tick}
            {...CHART.yAxis}
            width={unit === "money" ? 56 : 48}
          />
          {dd && (
            <ReferenceArea
              x1={Math.max(0, dd.peakIndex)}
              x2={dd.troughIndex}
              fill={VIZ.loss}
              fillOpacity={0.05}
              stroke="none"
              ifOverflow="hidden"
              label={{
                value: `Max DD ${formatValue(-dd.amount, unit, { signed: true })}`,
                position: "insideTop",
                fill: "var(--muted-foreground)",
                fontSize: 10,
              }}
            />
          )}
          <ReferenceLine
            y={baseline}
            stroke={VIZ.axis}
            strokeWidth={1}
            label={{ value: baselineLabel, position: "insideBottomLeft", fill: "var(--muted-foreground)", fontSize: 10 }}
          />
          <Tooltip content={tooltip} cursor={CHART.cursor} isAnimationActive={false} />
          <Area
            type="linear"
            dataKey="value"
            baseValue={baseline}
            stroke={`url(#${uid}-stroke)`}
            strokeWidth={CHART.lineWidth}
            fill={`url(#${uid}-fill)`}
            dot={false}
            activeDot={{ r: 4, stroke: VIZ.surface, strokeWidth: 2, fill: lineColorFor(0) }}
            animationDuration={CHART.animationMs}
          />
          {reference && (
            <Line
              type="linear"
              dataKey="ref"
              stroke={VIZ.reference}
              strokeWidth={1.5}
              strokeDasharray={CHART.referenceDash}
              dot={false}
              activeDot={{ r: 3, stroke: VIZ.surface, strokeWidth: 2, fill: VIZ.reference }}
              connectNulls
              animationDuration={CHART.animationMs}
            />
          )}
          {high && high.value > baseline && high.index !== last?.index && (
            <ReferenceDot
              x={high.index}
              y={high.value}
              r={3.5}
              fill={VIZ.profit}
              stroke={VIZ.surface}
              strokeWidth={2}
              label={{ value: "High", position: "top", fill: "var(--muted-foreground)", fontSize: 10 }}
            />
          )}
          {last && (
            <ReferenceDot
              x={last.index}
              y={last.value}
              r={4.5}
              fill={lineColorFor(last.value - baseline)}
              stroke={VIZ.surface}
              strokeWidth={2}
            />
          )}
        </ComposedChart>
      </ResponsiveContainer>

      {drawdownPane && rows.length > 1 && (
        <div>
          <div className="flex items-center justify-between px-1 text-[10px] tracking-wide text-muted-foreground uppercase">
            <span>Underwater</span>
            <span className="tabular-nums normal-case">
              {dd ? `max ${formatValue(-dd.amount, unit, { signed: true })}` : "no drawdown"}
            </span>
          </div>
          <ResponsiveContainer width="100%" height={drawdownHeight}>
            <AreaChart data={rows} syncId={syncId} margin={{ ...CHART.margin, top: 4, right: 28 }}>
              <defs>
                <linearGradient id={`${uid}-under`} x1="0" y1="0" x2="0" y2="1">
                  <stop offset={0} stopColor={VIZ.loss} stopOpacity={0.04} />
                  <stop offset={1} stopColor={VIZ.loss} stopOpacity={0.3} />
                </linearGradient>
              </defs>
              <CartesianGrid {...CHART.grid} />
              <XAxis dataKey="index" type="number" domain={[0, Math.max(0, rows.length - 1)]} hide />
              <YAxis
                dataKey={unit === "money" ? "underPct" : "under"}
                domain={underTicks.domain}
                ticks={underTicks.ticks}
                tickFormatter={(v: number) => (unit === "money" ? formatTick(v, "percent") : formatTick(v, unit))}
                tick={CHART.tick}
                {...CHART.yAxis}
                width={unit === "money" ? 56 : 48}
              />
              <Tooltip content={() => null} cursor={CHART.cursor} />
              <Area
                type="linear"
                dataKey={unit === "money" ? "underPct" : "under"}
                stroke={dd ? VIZ.loss : VIZ.neutral}
                strokeWidth={1.5}
                fill={`url(#${uid}-under)`}
                dot={false}
                activeDot={{ r: 3, stroke: VIZ.surface, strokeWidth: 2, fill: dd ? VIZ.loss : VIZ.neutral }}
                animationDuration={CHART.animationMs}
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  );
}

function lineColorFor(vsBaseline: number): string {
  return vsBaseline < 0 ? VIZ.loss : VIZ.profit;
}

function toneOf(n: number): "profit" | "loss" | "muted" {
  return n > 1e-9 ? "profit" : n < -1e-9 ? "loss" : "muted";
}

/** Range summary for a ChartCard headline/footer, from the same annotation the chart draws. */
export function summarizeEquity(points: EquityPoint[], baseline = 0): SeriesSummary | null {
  return annotateSeries(points.map((p) => ({ x: p.x, value: p.value })), baseline).summary;
}
