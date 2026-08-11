/**
 * Fixed-height placeholder shown while a lazy-loaded Recharts plot streams in.
 * It reserves exactly the plot's height so deferring the chart introduces no
 * layout shift (CLS) — the card chrome (title/tabs) is already painted; only the
 * plot area fills in once the recharts chunk arrives.
 */
export function ChartSkeleton({ height }: { height: number }) {
  return (
    <div
      style={{ height }}
      className="w-full animate-pulse rounded-xl bg-muted/30"
      aria-hidden
    />
  );
}
