import { fmtMoney, fmtWallClock } from "./format";

/**
 * Balance after each closed trade, drawn to scale (one x step per trade —
 * trade order, not calendar time — and a y axis from the lowest to the
 * highest balance). Pure SVG, theme colours via currentColor/tokens.
 */
export function EquityCurve({ points, currency }: { points: { time: string; balance: number }[]; currency: string }) {
  if (points.length < 2) {
    return <p className="py-10 text-center text-sm text-muted-foreground">The curve appears after the first closed trade.</p>;
  }
  const W = 640;
  const H = 200;
  const padL = 64;
  const padR = 8;
  const padT = 8;
  const padB = 20;
  const values = points.map((p) => p.balance);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const x = (i: number) => padL + (i / (points.length - 1)) * (W - padL - padR);
  const y = (v: number) => padT + (1 - (v - min) / span) * (H - padT - padB);
  const path = points.map((p, i) => `${i === 0 ? "M" : "L"}${x(i).toFixed(1)},${y(p.balance).toFixed(1)}`).join(" ");
  const start = values[0];
  const end = values[values.length - 1];
  const up = end >= start;
  const ticks = [max, (max + min) / 2, min];
  return (
    <figure className="space-y-1">
      <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full" role="img" aria-label={`Balance from ${fmtMoney(start, currency)} to ${fmtMoney(end, currency)} over ${points.length - 1} trades`}>
        {ticks.map((t) => (
          <g key={t}>
            <line x1={padL} x2={W - padR} y1={y(t)} y2={y(t)} stroke="currentColor" strokeOpacity={0.12} />
            <text x={padL - 6} y={y(t) + 3} textAnchor="end" fontSize={10} fill="currentColor" fillOpacity={0.6} className="font-mono">
              {fmtMoney(t, currency)}
            </text>
          </g>
        ))}
        <line x1={padL} x2={W - padR} y1={y(start)} y2={y(start)} stroke="currentColor" strokeOpacity={0.35} strokeDasharray="3 3" />
        <path d={path} fill="none" stroke={up ? "rgb(16 185 129)" : "rgb(248 113 113)"} strokeWidth={2} strokeLinejoin="round" />
        <circle cx={x(points.length - 1)} cy={y(end)} r={3.5} fill={up ? "rgb(16 185 129)" : "rgb(248 113 113)"} />
      </svg>
      <figcaption className="flex justify-between font-mono text-[11px] text-muted-foreground tabular-nums">
        <span>{fmtWallClock(points[0].time)}</span>
        <span>{points.length - 1} trade{points.length === 2 ? "" : "s"}</span>
        <span>{fmtWallClock(points[points.length - 1].time)}</span>
      </figcaption>
    </figure>
  );
}
