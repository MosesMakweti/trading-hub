/**
 * Paced reveal (pure). Playback requests can carry several playback steps
 * (the server settles every bar in order, so nothing is skipped); the chart
 * then shows them ONE STEP AT A TIME at the chosen speed. This splits one
 * response into those steps: consecutive ranges (from, to] of the playback
 * interval, each with only its own bars.
 *
 * The steps chain exactly (each `from` is the previous `to`, the first is the
 * response's fromMinute, the last ends at its toMinute), which is what a
 * chart's incremental fold requires.
 */
import { bucketStart, type ReplayTimeframe } from "@/domain/native-replay/timeframes";
import type { SimRevealedDTO } from "@/types/simulation";

export interface RevealStep {
  from: number;
  to: number;
  revealed: SimRevealedDTO[];
}

export function splitRevealed(revealed: SimRevealedDTO[], fromMinute: number, toMinute: number, tf: ReplayTimeframe): RevealStep[] {
  // Too many bars to send (null): the charts reload — nothing to pace.
  if (toMinute <= fromMinute || revealed.some((r) => r.bars == null)) return [{ from: fromMinute, to: toMinute, revealed }];
  // Step boundaries: the playback-interval bucket of every revealed bar (any instrument).
  const buckets = [...new Set(revealed.flatMap((r) => r.bars!.map((b) => bucketStart(b.minute, tf))))].sort((a, b) => a - b);
  if (buckets.length <= 1) return [{ from: fromMinute, to: toMinute, revealed }];
  const steps: RevealStep[] = [];
  let from = fromMinute;
  for (let i = 0; i < buckets.length; i++) {
    // A step ends where the next bucket starts (exclusive) — the last one at the response's end.
    const to = i === buckets.length - 1 ? toMinute : buckets[i + 1] - 1;
    steps.push({ from, to, revealed: revealed.map((r) => ({ ...r, bars: r.bars!.filter((b) => b.minute > from && b.minute <= to) })) });
    from = to;
  }
  return steps;
}
