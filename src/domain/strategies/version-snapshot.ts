import type {
  StrategyVersionSnapshot,
  StrategyVersionSummary,
} from "@/types/strategies";

/**
 * Compact summary of a published strategy-version snapshot — the counts and
 * headline names the version-history list shows. Pure and defensive: a snapshot
 * is denormalized JSON that may predate later shape changes, so every field is
 * read through optional access with sensible fallbacks.
 */
export function summarizeStrategyVersionSnapshot(
  snapshot: StrategyVersionSnapshot,
): StrategyVersionSummary {
  const timeframes = snapshot.timeframes ?? [];
  const checkpointCount = timeframes.reduce(
    (sum, tf) => sum + (tf.checkpoints?.length ?? 0),
    0,
  );

  const confluences = snapshot.confluences ?? [];

  return {
    applicableAssets: snapshot.applicableAssets ?? [],
    arsenalCount: snapshot.arsenalConcepts?.length ?? 0,
    frameworkStepTitles: (snapshot.frameworkSteps ?? []).map((s) => s.title),
    timeframeCount: timeframes.length,
    checkpointCount,
    entryModelNames: (snapshot.entryModels ?? []).map((m) => m.name),
    customRuleCount: snapshot.tradeManagement?.customRules?.length ?? 0,
    partialTpCount: snapshot.tradeManagement?.partialTakeProfits?.length ?? 0,
    sessionCount: snapshot.sessions?.length ?? 0,
    confluenceCount: confluences.length,
    mandatoryConfluenceCount: confluences.filter((c) => c.mandatory).length,
    executionCount: snapshot.execution?.length ?? 0,
  };
}
