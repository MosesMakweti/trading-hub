"use client";

import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import type {
  ConfluenceStat,
  SetupQualityBucket,
  SetupQualityTrendPoint,
} from "@/domain/performance/adherence-analytics";

// The whole adherence view is a magnitude story (win rate / average score), so
// every mark is a single brand hue — identity is carried by the axis text
// (band letters, confluence names), never by color alone. See the dataviz skill.
const TOOLTIP_STYLE = {
  background: "var(--popover)",
  border: "1px solid var(--border)",
  borderRadius: 8,
  fontSize: 12,
  color: "var(--popover-foreground)",
} as const;

const AXIS_TICK = { fill: "var(--muted-foreground)", fontSize: 11 } as const;

function EmptyChart({ label }: { label: string }) {
  return <p className="py-12 text-center text-sm text-muted-foreground">{label}</p>;
}

// Ordered quality bands get a sequential single-hue ramp (A+ solid → Low faded),
// reinforcing the ordinal without a categorical palette.
const BAND_OPACITY: Record<string, number> = { "A+": 1, A: 0.82, B: 0.62, C: 0.44, Low: 0.3 };

/** Setup Quality → Win Rate: does a higher weighted setup score actually win more? */
export function SetupQualityChart({ data }: { data: SetupQualityBucket[] }) {
  if (data.length === 0) {
    return <EmptyChart label="No rated setups in this range yet." />;
  }
  return (
    <ResponsiveContainer width="100%" height={200}>
      <BarChart data={data} margin={{ left: 0, right: 8, top: 8, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
        <XAxis dataKey="label" tick={AXIS_TICK} axisLine={{ stroke: "var(--border)" }} tickLine={false} />
        <YAxis
          domain={[0, 100]}
          tick={AXIS_TICK}
          axisLine={false}
          tickLine={false}
          width={40}
          tickFormatter={(v: number) => `${v}%`}
        />
        <ReferenceLine y={50} stroke="var(--border)" strokeDasharray="4 4" />
        <Tooltip
          cursor={{ fill: "var(--muted)", opacity: 0.4 }}
          contentStyle={TOOLTIP_STYLE}
          formatter={(value, _n, item) => {
            const p = item.payload as SetupQualityBucket;
            return [
              `${value == null ? "—" : `${Number(value).toFixed(1)}%`} win · ${p.trades} trade${p.trades === 1 ? "" : "s"} · avg ${p.avgScore ?? "—"}`,
              `${p.label} setups`,
            ];
          }}
        />
        <Bar dataKey="winRate" radius={[4, 4, 0, 0]} maxBarSize={48}>
          {data.map((d) => (
            <Cell key={d.rating} fill="var(--primary)" fillOpacity={BAND_OPACITY[d.label] ?? 0.6} />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

/** Per-confluence win rate — horizontal bars, ranked. */
export function ConfluenceWinRateChart({ data }: { data: ConfluenceStat[] }) {
  const rows = data.filter((c) => c.winRate != null).slice(0, 8);
  if (rows.length === 0) {
    return <EmptyChart label="No decided trades with confluences yet." />;
  }
  return (
    <ResponsiveContainer width="100%" height={Math.max(140, rows.length * 34 + 24)}>
      <BarChart data={rows} layout="vertical" margin={{ left: 8, right: 16, top: 4, bottom: 4 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" horizontal={false} />
        <XAxis
          type="number"
          domain={[0, 100]}
          tick={AXIS_TICK}
          axisLine={false}
          tickLine={false}
          tickFormatter={(v: number) => `${v}%`}
        />
        <YAxis
          type="category"
          dataKey="name"
          tick={AXIS_TICK}
          axisLine={false}
          tickLine={false}
          width={112}
        />
        <Tooltip
          cursor={{ fill: "var(--muted)", opacity: 0.4 }}
          contentStyle={TOOLTIP_STYLE}
          formatter={(value, _n, item) => {
            const c = item.payload as ConfluenceStat;
            return [`${Number(value).toFixed(1)}% · ${c.wins}W / ${c.losses}L`, c.name];
          }}
        />
        <Bar dataKey="winRate" radius={[0, 4, 4, 0]} maxBarSize={22} fill="var(--primary)" />
      </BarChart>
    </ResponsiveContainer>
  );
}

/** Average setup score over time — the discipline trend. */
export function SetupQualityTrendChart({ data }: { data: SetupQualityTrendPoint[] }) {
  if (data.length < 2) {
    return <EmptyChart label="Not enough months to chart a trend yet." />;
  }
  return (
    <ResponsiveContainer width="100%" height={200}>
      <LineChart data={data} margin={{ left: 0, right: 8, top: 8, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
        <XAxis dataKey="month" tick={AXIS_TICK} axisLine={{ stroke: "var(--border)" }} tickLine={false} />
        <YAxis
          domain={[0, 100]}
          tick={AXIS_TICK}
          axisLine={false}
          tickLine={false}
          width={40}
          tickFormatter={(v: number) => `${v}%`}
        />
        <Tooltip
          contentStyle={TOOLTIP_STYLE}
          formatter={(value, _n, item) => {
            const p = item.payload as SetupQualityTrendPoint;
            return [`${value == null ? "—" : Number(value).toFixed(1)} avg · ${p.trades} trade${p.trades === 1 ? "" : "s"}`, p.month];
          }}
        />
        <Line
          type="monotone"
          dataKey="avgScore"
          stroke="var(--primary)"
          strokeWidth={2}
          dot={{ r: 3, fill: "var(--primary)" }}
          activeDot={{ r: 5 }}
        />
      </LineChart>
    </ResponsiveContainer>
  );
}
