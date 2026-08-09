import { describe, expect, it } from "vitest";

import { aggregateMissReasons, type MissReasonRow } from "./miss-reasons";

describe("aggregateMissReasons", () => {
  it("ranks reasons by missed cost, counting only forgone winners", () => {
    const rows: MissReasonRow[] = [
      { reason: "FEAR", missedRealizedR: 3 }, // costly lapse
      { reason: "FEAR", missedRealizedR: -1 }, // missed loss → 0 cost, still counted
      { reason: "HESITATION", missedRealizedR: 1 },
      { reason: "DISTRACTED", missedRealizedR: null }, // undetermined → 0 cost
    ];
    const agg = aggregateMissReasons(rows);
    expect(agg.totalMissed).toBe(4);
    expect(agg.byReason[0].reason).toBe("FEAR");
    expect(agg.byReason[0].count).toBe(2);
    expect(agg.byReason[0].missedCostR).toBe(3);
    expect(agg.byReason[1].reason).toBe("HESITATION");
    expect(agg.costliestLapse?.reason).toBe("FEAR");
  });

  it("separates disciplined passes from lapses", () => {
    const rows: MissReasonRow[] = [
      { reason: "INTENTIONAL_SKIP", missedRealizedR: 2 }, // disciplined — not a lapse cost
      { reason: "RISK_CONCERNS", missedRealizedR: null },
      { reason: "FOMO_ELSEWHERE", missedRealizedR: 1.5 },
    ];
    const agg = aggregateMissReasons(rows);
    expect(agg.disciplinedCount).toBe(2);
    expect(agg.lapseCount).toBe(1);
    expect(agg.lapseCostR).toBe(1.5); // only the FOMO lapse, disciplined skip excluded
    expect(agg.costliestLapse?.reason).toBe("FOMO_ELSEWHERE");
  });

  it("folds a null reason into OTHER and returns no costliest lapse when nothing was forgone", () => {
    const agg = aggregateMissReasons([
      { reason: null, missedRealizedR: null },
      { reason: "HESITATION", missedRealizedR: -2 },
    ]);
    expect(agg.byReason.some((r) => r.reason === "OTHER")).toBe(true);
    expect(agg.costliestLapse).toBeNull();
  });

  it("returns an empty aggregate for no misses", () => {
    const agg = aggregateMissReasons([]);
    expect(agg.totalMissed).toBe(0);
    expect(agg.byReason).toEqual([]);
    expect(agg.costliestLapse).toBeNull();
  });
});
