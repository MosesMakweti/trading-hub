"use client";

import { Area, AreaChart, ResponsiveContainer } from "recharts";

/** Lazy-loaded Recharts body for the account-card sparkline (assumes ≥2 points). */
export function MiniEquityCurvePlot({ points }: { points: { balance: number }[] }) {
  const isUp = points[points.length - 1].balance >= points[0].balance;
  const color = isUp ? "var(--success)" : "var(--danger)";

  return (
    <ResponsiveContainer width="100%" height={48}>
      <AreaChart data={points} margin={{ top: 2, right: 2, bottom: 2, left: 2 }}>
        <defs>
          <linearGradient id="miniEquityFill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity={0.3} />
            <stop offset="100%" stopColor={color} stopOpacity={0} />
          </linearGradient>
        </defs>
        <Area
          type="monotone"
          dataKey="balance"
          stroke={color}
          strokeWidth={1.5}
          fill="url(#miniEquityFill)"
          dot={false}
          isAnimationActive={false}
        />
      </AreaChart>
    </ResponsiveContainer>
  );
}
