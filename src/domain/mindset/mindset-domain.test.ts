import { describe, expect, it } from "vitest";

import { DEFAULT_CATEGORIES, DEFAULT_MANTRAS } from "@/domain/mindset/defaults";
import { BREATHING_PATTERNS } from "@/domain/mindset/options";
import { breathAt, breathingTotalMs } from "@/domain/mindset/breathing";
import { buildPlaylist, currentMantraIndex, initialSession, MAX_TICK_MS, sessionReducer, type SessionConfig } from "@/domain/mindset/session";
import { mantrasForRecommendation, recommendFromReviews, PATTERNS } from "@/domain/mindset/recommendations";
import { selectSessionMantras } from "@/domain/mindset/selection";

const cfg = (o: Partial<SessionConfig> = {}): SessionConfig => ({
  durationMs: 60_000, slideMs: 5_000, mantraCount: 3, order: "SEQUENTIAL", repeat: true, breathing: null, seed: 42, ...o,
});

function run(config: SessionConfig, ms: number, step = 100) {
  const reduce = sessionReducer(config);
  let s = initialSession(config);
  for (let t = 0; t < ms; t += step) s = reduce(s, { type: "TICK", dt: step });
  return { s, reduce };
}

describe("default mantras", () => {
  it("have unique keys and only the documented categories", () => {
    expect(new Set(DEFAULT_MANTRAS.map((m) => m.key)).size).toBe(DEFAULT_MANTRAS.length);
    for (const m of DEFAULT_MANTRAS) expect(DEFAULT_CATEGORIES).toContain(m.category);
  });

  it("cover every recommendation's focus mantras", () => {
    const keys = new Set(DEFAULT_MANTRAS.map((m) => m.key));
    for (const p of PATTERNS) for (const k of p.focusKeys) expect(keys.has(k)).toBe(true);
  });
});

describe("slideshow progression", () => {
  it("advances sequentially at the configured time per mantra", () => {
    const { s } = run(cfg(), 5_000);
    expect(currentMantraIndex(s)).toBe(1);
    expect(currentMantraIndex(run(cfg(), 10_000).s)).toBe(2);
  });

  it("repeats the collection, or ends after one pass without repeat", () => {
    expect(currentMantraIndex(run(cfg(), 15_000).s)).toBe(0);
    expect(run(cfg(), 15_000).s.passes).toBe(1);
    const once = run(cfg({ repeat: false }), 15_000).s;
    expect(once.phase).toBe("complete");
    expect(once.endedEarly).toBe(false);
  });

  it("ends exactly when the session duration is reached", () => {
    expect(run(cfg({ durationMs: 12_000 }), 11_900).s.phase).toBe("mantras");
    expect(run(cfg({ durationMs: 12_000 }), 12_000).s.phase).toBe("complete");
  });

  it("supports manual previous/next without breaking the timer", () => {
    const config = cfg();
    const reduce = sessionReducer(config);
    let s = initialSession(config);
    for (let i = 0; i < 6; i++) s = reduce(s, { type: "TICK", dt: 500 });
    s = reduce(s, { type: "NEXT" });
    expect(currentMantraIndex(s)).toBe(1);
    expect(s.slideMs).toBe(0); // fresh full display time after a manual change
    s = reduce(s, { type: "PREV" });
    s = reduce(s, { type: "PREV" });
    expect(currentMantraIndex(s)).toBe(0);
    expect(s.activeMs).toBe(3_000);
  });

  it("manual next at the end without repeat stays put instead of ending the session", () => {
    const config = cfg({ repeat: false });
    const reduce = sessionReducer(config);
    let s = initialSession(config);
    for (let i = 0; i < 5; i++) s = reduce(s, { type: "NEXT" });
    expect(s.phase).toBe("mantras");
    expect(currentMantraIndex(s)).toBe(2);
  });
});

describe("pause and resume", () => {
  it("freezes time while paused, and repeated pause/resume clicks are harmless", () => {
    const config = cfg();
    const reduce = sessionReducer(config);
    let s = initialSession(config);
    for (let i = 0; i < 4; i++) s = reduce(s, { type: "TICK", dt: 500 });
    s = reduce(s, { type: "PAUSE" });
    s = reduce(s, { type: "PAUSE" });
    for (let i = 0; i < 50; i++) s = reduce(s, { type: "TICK", dt: 400 });
    expect(s.activeMs).toBe(2_000);
    s = reduce(s, { type: "RESUME" });
    s = reduce(s, { type: "RESUME" });
    s = reduce(s, { type: "TICK", dt: 400 });
    expect(s.activeMs).toBe(2_400);
    expect(s.paused).toBe(false);
  });

  it("clamps one huge tick (e.g. a throttled background tab) instead of fast-forwarding", () => {
    const config = cfg();
    const s = sessionReducer(config)(initialSession(config), { type: "TICK", dt: 60_000 });
    expect(s.activeMs).toBe(MAX_TICK_MS);
    expect(s.phase).toBe("mantras");
  });

  it("ignores everything once complete, and END marks an early finish", () => {
    const config = cfg();
    const reduce = sessionReducer(config);
    let s = reduce(initialSession(config), { type: "END" });
    expect(s).toMatchObject({ phase: "complete", endedEarly: true });
    const frozen = s;
    s = reduce(s, { type: "TICK", dt: 100 });
    s = reduce(s, { type: "NEXT" });
    expect(s).toBe(frozen);
  });
});

describe("randomized order", () => {
  it("is a permutation, deterministic for a seed, and never repeats a mantra across a pass boundary", () => {
    const [a] = buildPlaylist(8, "RANDOM", 7);
    const [b] = buildPlaylist(8, "RANDOM", 7);
    expect(a).toEqual(b);
    expect([...a].sort()).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
    for (let seed = 1; seed < 50; seed++) {
      const [list] = buildPlaylist(5, "RANDOM", seed, 3);
      expect(list[0]).not.toBe(3);
    }
  });

  it("reshuffles between passes in a randomized session", () => {
    const config = cfg({ order: "RANDOM", mantraCount: 6, slideMs: 1_000 });
    const reduce = sessionReducer(config);
    let s = initialSession(config);
    const first = s.playlist;
    for (let i = 0; i < 12; i++) s = reduce(s, { type: "TICK", dt: 500 });
    expect(s.passes).toBe(1);
    expect(s.playlist).not.toEqual(first);
  });
});

describe("breathing", () => {
  const calm = BREATHING_PATTERNS.calm;

  it("guides inhale then exhale with a smooth size curve", () => {
    expect(breathAt(calm, 0)).toMatchObject({ step: "inhale", scale: 0, cycle: 1 });
    expect(breathAt(calm, 2_000).scale).toBeCloseTo(0.5);
    expect(breathAt(calm, 4_000)).toMatchObject({ step: "exhale", cycle: 1 });
    expect(breathAt(calm, 10_000)).toMatchObject({ step: "inhale", cycle: 2 });
    expect(breathAt(calm, breathingTotalMs(calm)).done).toBe(true);
  });

  it("includes only gentle optional pauses", () => {
    for (const p of Object.values(BREATHING_PATTERNS)) {
      expect(p.holdIn).toBeLessThanOrEqual(2);
      expect(p.holdOut).toBeLessThanOrEqual(2);
    }
    expect(breathAt(BREATHING_PATTERNS.settle, 5_000)).toMatchObject({ step: "holdIn", scale: 1 });
  });

  it("never takes more than half a short session", () => {
    const config = cfg({ breathing: calm, durationMs: 60_000 });
    const mid = run(config, 30_000).s;
    expect(mid.phase).toBe("mantras");
  });

  it("runs before the mantras and can be skipped", () => {
    const config = cfg({ breathing: calm, durationMs: 300_000 });
    const reduce = sessionReducer(config);
    let s = initialSession(config);
    expect(s.phase).toBe("breathing");
    s = reduce(s, { type: "TICK", dt: 400 });
    expect(currentMantraIndex(s)).toBeNull();
    expect(reduce(s, { type: "SKIP_BREATHING" }).phase).toBe("mantras");
    const done = run(config, breathingTotalMs(calm)).s;
    expect(done.phase).toBe("mantras");
  });
});

describe("selection", () => {
  const lib = [
    { id: "a", category: "Patience", enabled: true, sortOrder: 2 },
    { id: "b", category: "Discipline", enabled: true, sortOrder: 1 },
    { id: "c", category: "Patience", enabled: false, sortOrder: 0 },
  ];
  it("uses individual picks, then categories, then everything enabled — never disabled ones", () => {
    expect(selectSessionMantras(lib, { mantraIds: ["a", "c"], categories: ["Discipline"] }).map((m) => m.id)).toEqual(["a"]);
    expect(selectSessionMantras(lib, { mantraIds: [], categories: ["Patience"] }).map((m) => m.id)).toEqual(["a"]);
    expect(selectSessionMantras(lib, { mantraIds: [], categories: [] }).map((m) => m.id)).toEqual(["b", "a"]);
  });
});

describe("recommendations from Edge Review", () => {
  const review = (id: string, weekStart: string, tags: string[]) => ({ auditId: id, weekStart, tags });

  it("returns nothing with no or too little review history", () => {
    expect(recommendFromReviews([])).toEqual([]);
    expect(recommendFromReviews([review("a1", "2026-11-16", ["weakness:IMPATIENCE", "weakness:IMPATIENCE", "invalid:EARLY_ENTRY"])])).toEqual([]);
  });

  it("does not treat an isolated mistake as a pattern", () => {
    const recs = recommendFromReviews([review("a1", "2026-11-16", ["invalid:REVENGE"]), review("a2", "2026-11-09", ["weakness:IMPATIENCE"])]);
    expect(recs).toEqual([]);
  });

  it("requires the pattern to recur across at least two reviews", () => {
    const oneReviewOnly = recommendFromReviews([review("a1", "2026-11-16", ["invalid:REVENGE", "invalid:REVENGE", "weakness:REVENGE_EMOTION"]), review("a2", "2026-11-09", [])]);
    expect(oneReviewOnly).toEqual([]);
  });

  it("maps recurring tags to the right pattern and explains why", () => {
    const [rec, ...rest] = recommendFromReviews([
      review("a3", "2026-11-16", ["weakness:IMPATIENCE", "weakness:FOMO"]),
      review("a2", "2026-11-09", ["weakness:IMPATIENCE"]),
      review("a1", "2026-11-02", ["invalid:REVENGE"]),
    ]);
    expect(rest).toEqual([]);
    expect(rec).toMatchObject({ pattern: "PATIENCE", title: "Patience & Discipline", categories: ["Patience", "Discipline"], occurrences: 3, reviewCount: 2, key: "PATIENCE:a3" });
    expect(rec.reason).toContain("3 times across 2 of your last 3 finalized reviews");
    expect(rec.reason).toContain("impatience");
  });

  it("ranks by how many reviews a pattern spans and only looks at recent reviews", () => {
    const recs = recommendFromReviews([
      review("r7", "2026-11-16", ["invalid:REVENGE", "invalid:EARLY_ENTRY"]),
      review("r6", "2026-11-09", ["invalid:REVENGE", "issue:NO_CONFIRMATION"]),
      review("r5", "2026-11-02", ["invalid:REVENGE"]),
      review("r4", "2026-10-26", []),
      review("r3", "2026-10-19", []),
      review("r2", "2026-10-12", []),
      // Outside the 6-review lookback — must not count.
      review("r1", "2026-10-05", ["issue:ENTRY_TIMING", "issue:ENTRY_TIMING", "issue:ENTRY_TIMING"]),
    ]);
    expect(recs.map((r) => r.pattern)).toEqual(["EMOTIONAL_CONTROL"]);
  });

  it("changes its key when new evidence arrives (so a dismissal doesn't hide new findings forever)", () => {
    const base = [review("a2", "2026-11-09", ["invalid:RISK_VIOLATION", "invalid:RISK_VIOLATION"]), review("a1", "2026-11-02", ["issue:STOP_PLACEMENT"])];
    const k1 = recommendFromReviews(base)[0].key;
    const k2 = recommendFromReviews([review("a3", "2026-11-16", []), ...base])[0].key;
    expect(k1).toBe("RISK:a2");
    expect(k2).toBe("RISK:a3");
  });

  it("builds the session from the trader's own enabled mantras, focus ones first", () => {
    const rec = recommendFromReviews([review("a2", "2026-11-09", ["weakness:IMPATIENCE", "weakness:IMPATIENCE"]), review("a1", "2026-11-02", ["weakness:FOMO"])])[0];
    const library = [
      { id: "1", category: "Discipline", defaultKey: "discipline.follow-plan", enabled: true },
      { id: "2", category: "Patience", defaultKey: null, enabled: true },
      { id: "3", category: "Patience", defaultKey: "patience.no-chasing", enabled: true },
      { id: "4", category: "Patience", defaultKey: "patience.missing-better", enabled: false },
      { id: "5", category: "Risk Management", defaultKey: "risk.know-before-entry", enabled: true },
    ];
    expect(mantrasForRecommendation(rec, library).map((m) => m.id)).toEqual(["3", "2", "1"]);
  });
});
