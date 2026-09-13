/**
 * Historical StrategyVersion resolution (Stage 14 §3) — pure selection logic
 * over an already-fetched version list; the DB read lives in
 * replay-review.service.ts's `resolveHistoricalStrategyVersion`.
 *
 * FALLBACK POLICY (documented per §3's requirement): when no published
 * version exists at or before `atTime`, this returns `null`. There is no
 * silent fallback to the strategy's current live config — the caller must
 * tell the trader "no historical Strategy configuration is available for
 * this date" and let them either pick a different strategy or proceed
 * without one. Audited: this codebase has no other historical-strategy
 * source (no daily snapshot table) than `StrategyVersion` rows, so "no
 * version published early enough" and "no version ever published" are
 * treated identically — both mean historical accuracy cannot be guaranteed,
 * and Replay must say so rather than fabricate it.
 */

export interface VersionLike {
  version: number;
  createdAt: Date | number;
}

function toMs(createdAt: Date | number): number {
  return typeof createdAt === "number" ? createdAt : createdAt.getTime();
}

/**
 * The LATEST version whose publish time is at or before `atTime`, or `null`
 * if every version postdates it (or none exist). `versions` need not be
 * pre-sorted.
 */
export function pickVersionAtTime<T extends VersionLike>(versions: T[], atTime: number): T | null {
  const sorted = [...versions].sort((a, b) => toMs(a.createdAt) - toMs(b.createdAt));
  let candidate: T | null = null;
  for (const v of sorted) {
    if (toMs(v.createdAt) <= atTime) candidate = v;
    else break;
  }
  return candidate;
}
