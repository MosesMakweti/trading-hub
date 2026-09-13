import type { AnalystOutcome, TraderReviewAnalystProvider, TraderReviewEvidencePackage } from "@/domain/ai-review/types";

/**
 * Always available, never actually analyzes anything (mirrors
 * `NullRecognitionProvider` from the Trade Plan screenshot-recognition
 * feature — the same "unavailable is a real, tested state" precedent).
 * This is what the resolver falls back to when no real provider is
 * configured, so "AI analysis unavailable" is a first-class UI state
 * rather than untested code (§39: never substitute fabricated analysis).
 */
export class NullTraderReviewAnalystProvider implements TraderReviewAnalystProvider {
  readonly name = "none";
  readonly version = "1.0.0";

  isAvailable(): boolean {
    return true;
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars -- signature must match TraderReviewAnalystProvider
  async analyzeReview(_evidence: TraderReviewEvidencePackage): Promise<AnalystOutcome> {
    return {
      status: "FAILED",
      reason: "PROVIDER_UNAVAILABLE",
      error: "AI analysis isn't configured for this workspace yet.",
    };
  }
}
