"use client";

import { useEffect, useRef } from "react";
import { toast } from "sonner";
import type { UseFormGetValues, UseFormSetValue } from "react-hook-form";

import type { TradeFormValues } from "@/lib/validation/trades";
import type { StrategyReferenceDTO } from "@/types/strategies";

/**
 * The strategy-scoped selection protections, shared by the Journal TradeForm
 * and the Today V3 Quick Idea (extracted unchanged from TradeForm):
 *
 *  1. When the strategy changes, clear every selection that belongs to
 *     exactly one strategy (entry model, setup type + conditions + override,
 *     confluences, execution confirmations) so nothing from the previous
 *     strategy's checklist can carry over. The very first run is skipped so
 *     an edit-mode trade (or an inherited default strategy) keeps its
 *     selections on mount.
 *  2. When the direction flips, drop selected confluences that no longer
 *     apply (e.g. bullish-only after switching to Short) and say what was
 *     removed — silent removal would look like lost data. BOTH picks and
 *     unknown names are kept. Also skips the first run.
 */
export function useStrategyScopedSelections({
  strategyId,
  direction,
  strategyReference,
  setValue,
  getValues,
}: {
  strategyId: string | undefined;
  direction: TradeFormValues["direction"] | undefined;
  strategyReference: StrategyReferenceDTO | null;
  setValue: UseFormSetValue<TradeFormValues>;
  getValues: UseFormGetValues<TradeFormValues>;
}) {
  const strategyInitialised = useRef(false);
  useEffect(() => {
    if (!strategyInitialised.current) {
      strategyInitialised.current = true;
      return;
    }
    setValue("selectedEntryModel", null);
    setValue("setupTypeId", null);
    setValue("selectedSetupConditions", []);
    setValue("setupOverrideReason", null);
    setValue("setupOverrideNote", null);
    setValue("selectedConfluences", [], { shouldDirty: true, shouldValidate: true });
    setValue("selectedExecution", [], { shouldDirty: true, shouldValidate: true });
  }, [strategyId, setValue]);

  const directionInitialised = useRef(false);
  useEffect(() => {
    if (!directionInitialised.current) {
      directionInitialised.current = true;
      return;
    }
    const confluences = strategyReference?.confluences;
    if (!confluences || confluences.length === 0) return;
    const applicability = new Map(confluences.map((c) => [c.name.toLowerCase(), c.directionApplicability ?? "BOTH"]));
    const current = (getValues("selectedConfluences") ?? []) as string[];
    const kept = current.filter((n) => {
      const a = applicability.get(n.toLowerCase());
      // Unknown name (not in this strategy) → leave it be; scoring ignores it.
      if (a == null) return true;
      return a === "BOTH" || (direction === "LONG" ? a === "BULLISH" : a === "BEARISH");
    });
    if (kept.length === current.length) return;
    const removed = current.length - kept.length;
    setValue("selectedConfluences", kept, { shouldDirty: true, shouldValidate: true });
    toast.info(
      `${removed} ${direction === "LONG" ? "bearish" : "bullish"}-only ${
        removed === 1 ? "confluence was" : "confluences were"
      } removed because this trade is now ${direction === "LONG" ? "Long" : "Short"}.`,
    );
  }, [direction, strategyReference, getValues, setValue]);
}
