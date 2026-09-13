import { prisma } from "@/server/db";
import { dateKeyToUtcDate, utcDateToKey } from "@/lib/date";
import {
  computeAdherence,
  computeResolutionEligibility,
  classifyTrend,
  deriveBehaviourLabelObservations,
  deriveMissedOpportunityObservations,
  deriveOverrideDisciplineObservations,
  deriveOvertradingObservations,
  derivePrematureCloseObservations,
  deriveRiskLimitObservations,
  deriveStopWideningObservations,
  effectiveLineageId,
  hasAutomaticEvidenceRule,
  type AdherenceResult,
  type AutomaticEvidenceRuleKey,
  type DailyStateForAdherence,
} from "@/domain/improvements/commitment-adherence";
import { getReplayComparison } from "@/server/services/replay-comparison.service";
import { Prisma } from "@prisma/client";
import type {
  EdgeReviewCommitment,
  EdgeReviewCommitmentCategory,
  EdgeReviewCommitmentDailyStatus,
  EdgeReviewCommitmentPriority,
  EdgeReviewCommitmentStatus,
  ReplayReviewType,
} from "@prisma/client";
import type {
  CommitmentLineageDTO,
  CommitmentObservationDTO,
  ContextualReminderDTO,
  EdgeReviewCommitmentDTO,
  ImprovementAnalyticsDTO,
  TodayCommitmentsDTO,
} from "@/types/edge-improvements";

/**
 * Improvement Commitments (Stage 16 §6-21) — a durable record the trader
 * explicitly approves, either self-authored (§8, `source: MANUAL`) or
 * accepted from a deterministic suggestion (§9-10, `source: SUGGESTED`,
 * freezing `sourceFindingType`/`evidenceSnapshot` at accept time so the
 * evidence stays historical even if the underlying comparison were somehow
 * recomputed differently later — §28). Never auto-created: every write
 * path here is a trader action.
 */

function toDTO(row: EdgeReviewCommitment): EdgeReviewCommitmentDTO {
  return {
    id: row.id,
    replayReviewSessionId: row.replayReviewSessionId,
    reviewType: row.reviewType,
    periodStart: utcDateToKey(row.periodStart),
    category: row.category,
    title: row.title,
    description: row.description,
    priority: row.priority,
    status: row.status,
    source: row.source,
    sourceFindingType: row.sourceFindingType,
    evidenceSnapshot: (row.evidenceSnapshot as string[] | null) ?? null,
    previousCommitmentId: row.previousCommitmentId,
    lineageId: row.lineageId,
    completedAt: row.completedAt?.toISOString() ?? null,
    retiredAt: row.retiredAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function toAdherenceResultDTO(result: AdherenceResult) {
  return {
    followed: result.followed,
    breached: result.breached,
    acknowledgedCount: result.acknowledgedCount,
    applicableObservations: result.applicableObservations,
    adherencePercent: result.adherence == null ? null : Math.round(result.adherence * 100),
  };
}

/**
 * Stage 19.1 §11 — a SYSTEM daily-state's `evidence` JSON is always
 * `{description, category}` (written only by `syncSystemEvidenceForSession`,
 * §16's own doc comment). Reads out just the human-readable sentence; never
 * returns the raw JSON blob to a caller, and returns null for anything that
 * isn't that exact shape (a MANUAL row's null evidence, or any unexpected
 * shape) rather than guessing.
 */
function evidenceDescriptionOf(evidence: Prisma.JsonValue | null): string | null {
  if (evidence != null && typeof evidence === "object" && !Array.isArray(evidence) && typeof (evidence as { description?: unknown }).description === "string") {
    return (evidence as { description: string }).description;
  }
  return null;
}

async function ownedSession(userId: string, sessionId: string) {
  const session = await prisma.replayReviewSession.findFirst({
    where: { id: sessionId, userId },
    select: { id: true, reviewType: true, startDate: true },
  });
  if (!session) throw new Error("Review session not found.");
  return session;
}

/**
 * §8 — trader-authored, fast to create (title/description/category/priority
 * only). Stage 19.1 §24 adds an OPTIONAL opt-in: the trader may attach one
 * of the known deterministic `AUTOMATIC_EVIDENCE_RULE_KEYS` even to a
 * self-authored commitment (validated server-side against that fixed list
 * — never arbitrary text). `source` stays `MANUAL` regardless — it records
 * WHO authored the commitment; `sourceFindingType` separately records
 * WHETHER a deterministic rule can supply its evidence. These are
 * orthogonal, so a manual commitment can still be automatically tracked.
 */
export async function createManualCommitment(
  userId: string,
  sessionId: string,
  input: {
    category: EdgeReviewCommitmentCategory;
    title: string;
    description: string | null;
    priority: EdgeReviewCommitmentPriority;
    automaticRuleKey?: AutomaticEvidenceRuleKey | null;
  },
): Promise<EdgeReviewCommitmentDTO> {
  const session = await ownedSession(userId, sessionId);
  const row = await prisma.edgeReviewCommitment.create({
    data: {
      userId,
      replayReviewSessionId: session.id,
      reviewType: session.reviewType,
      periodStart: session.startDate,
      category: input.category,
      title: input.title,
      description: input.description,
      priority: input.priority,
      source: "MANUAL",
      sourceFindingType: input.automaticRuleKey ?? null,
    },
  });
  return toDTO(row);
}

/** §9-10 — turns a deterministic `SuggestedCommitment` (domain/replay-
 *  improvements) into a durable record. The trader may have edited the
 *  title/description/category/priority before accepting; whatever they
 *  submit here is what's frozen. */
export async function acceptSuggestedCommitment(
  userId: string,
  sessionId: string,
  input: {
    category: EdgeReviewCommitmentCategory;
    title: string;
    description: string | null;
    priority: EdgeReviewCommitmentPriority;
    ruleKey: string;
    evidence: string[];
  },
): Promise<EdgeReviewCommitmentDTO> {
  const session = await ownedSession(userId, sessionId);
  const row = await prisma.edgeReviewCommitment.create({
    data: {
      userId,
      replayReviewSessionId: session.id,
      reviewType: session.reviewType,
      periodStart: session.startDate,
      category: input.category,
      title: input.title,
      description: input.description,
      priority: input.priority,
      source: "SUGGESTED",
      sourceFindingType: input.ruleKey,
      evidenceSnapshot: input.evidence,
    },
  });
  return toDTO(row);
}

export async function updateCommitment(
  userId: string,
  id: string,
  patch: Partial<{ category: EdgeReviewCommitmentCategory; title: string; description: string | null; priority: EdgeReviewCommitmentPriority }>,
): Promise<void> {
  const result = await prisma.edgeReviewCommitment.updateMany({ where: { id, userId }, data: patch });
  if (result.count === 0) throw new Error("Commitment not found.");
}

/** §14 — ACTIVE/COMPLETED/RETIRED lifecycle. Stamps/clears `completedAt`/
 *  `retiredAt` to match; reactivating back to ACTIVE clears both (a
 *  commitment is never "completed and also currently active"). */
export async function setCommitmentStatus(userId: string, id: string, status: EdgeReviewCommitmentStatus): Promise<void> {
  const now = new Date();
  const result = await prisma.edgeReviewCommitment.updateMany({
    where: { id, userId },
    data: {
      status,
      completedAt: status === "COMPLETED" ? now : null,
      retiredAt: status === "RETIRED" ? now : null,
    },
  });
  if (result.count === 0) throw new Error("Commitment not found.");
}

export async function listCommitmentsForSession(userId: string, sessionId: string): Promise<EdgeReviewCommitmentDTO[]> {
  const rows = await prisma.edgeReviewCommitment.findMany({
    where: { userId, replayReviewSessionId: sessionId },
    orderBy: { createdAt: "asc" },
  });
  return rows.map(toDTO);
}

async function latestFinalizedSessionId(userId: string, reviewType: ReplayReviewType): Promise<string | null> {
  const session = await prisma.replayReviewSession.findFirst({
    where: { userId, reviewType, reviewFinalizedAt: { not: null } },
    orderBy: { startDate: "desc" },
    select: { id: true },
  });
  return session?.id ?? null;
}

async function listActiveCommitmentsForSession(userId: string, sessionId: string): Promise<EdgeReviewCommitmentDTO[]> {
  const rows = await prisma.edgeReviewCommitment.findMany({
    where: { userId, replayReviewSessionId: sessionId, status: "ACTIVE" },
    orderBy: [{ priority: "asc" }, { createdAt: "asc" }],
  });
  return rows.map(toDTO);
}

/**
 * "Next-Period Commitments" (Stage 19 — Improvements tab, 4th new section) —
 * still-ACTIVE commitments from the last FINALIZED review of the SAME
 * reviewType, when that's a genuinely different period than the one
 * currently open. This is what a trader decides Continue/Refine/Resolve/
 * Dismiss on when opening a new period's Improvements tab — reusing the
 * exact same "latest finalized wins" resolution Today already uses, so the
 * two surfaces can never disagree about which commitments are still live.
 */
export async function listCarryForwardCandidates(
  userId: string,
  reviewType: ReplayReviewType,
  currentSessionId: string | null,
): Promise<EdgeReviewCommitmentDTO[]> {
  const sourceSessionId = await latestFinalizedSessionId(userId, reviewType);
  if (!sourceSessionId || sourceSessionId === currentSessionId) return [];
  return listActiveCommitmentsForSession(userId, sourceSessionId);
}

/**
 * Today's carry-forward (Stage 16 §15-16) — "latest finalized review wins"
 * precedence, kept deliberately simple: for each of WEEKLY/MONTHLY
 * independently, find the most recently-STARTED review that has actually
 * been finalized (`reviewFinalizedAt` set — see ReplayReviewSession's own
 * doc comment for why that's distinct from `status: COMPLETED`), then
 * return only its still-ACTIVE commitments. A newer finalized review of the
 * same type automatically supersedes the old one (its commitments simply
 * stop being the "latest"), without deleting or mutating anything — the
 * older session's own commitments remain visible from ITS OWN Edge Review
 * page forever (§21). Weekly and monthly are always returned as two
 * separate groups, never merged (§16).
 */
export async function getActiveCommitmentsForToday(userId: string): Promise<TodayCommitmentsDTO> {
  const [weeklySessionId, monthlySessionId] = await Promise.all([
    latestFinalizedSessionId(userId, "WEEKLY"),
    latestFinalizedSessionId(userId, "MONTHLY"),
  ]);
  const [weekly, monthly] = await Promise.all([
    weeklySessionId ? listActiveCommitmentsForSession(userId, weeklySessionId) : Promise.resolve([]),
    monthlySessionId ? listActiveCommitmentsForSession(userId, monthlySessionId) : Promise.resolve([]),
  ]);

  // Stage 19 §17/§27/§28 — a single continuation chain can only ever have
  // one ACTIVE head, so it can only ever appear in exactly one of these two
  // groups already. The real duplicate-reminder risk is two INDEPENDENT
  // commitments — one accepted from a weekly review, one from an
  // overlapping monthly review — built from the same deterministic
  // suggestion rule (§10: "commitment identity via stable ruleKey/source
  // identity, no AI semantic matching"). Identity for this dedup is
  // `lineageId` when the commitment is part of an explicit Continue/Refine
  // chain, else its `sourceFindingType` when it's SUGGESTED-origin (a
  // MANUAL commitment has no shared identity with anything else and is
  // never deduped). Weekly takes precedence as the nearer-term surface;
  // the dropped monthly commitment's own Edge Review page is untouched.
  function identityOf(c: EdgeReviewCommitmentDTO): string | null {
    return c.lineageId ?? c.sourceFindingType ?? null;
  }
  const weeklyIdentities = new Set(weekly.map(identityOf).filter((x): x is string => x != null));
  const dedupedMonthly = monthly.filter((c) => {
    const identity = identityOf(c);
    return identity == null || !weeklyIdentities.has(identity);
  });

  return { weekly, monthly: dedupedMonthly };
}

// ── Daily acknowledgement (Stage 16 §18) — optional, separate from the
// commitment record itself; never rewrites historical review data (§17). ──

export async function setCommitmentDailyState(
  userId: string,
  commitmentId: string,
  dateKey: Date,
  status: EdgeReviewCommitmentDailyStatus,
  note?: string | null,
): Promise<void> {
  const commitment = await prisma.edgeReviewCommitment.findFirst({ where: { id: commitmentId, userId }, select: { id: true } });
  if (!commitment) throw new Error("Commitment not found.");

  // A trader's own self-report is always `source: MANUAL` — even when it
  // overwrites a row a prior SYSTEM derivation wrote for the same day. The
  // trader's account of their own day always wins; the reverse (SYSTEM
  // silently overwriting a MANUAL entry) never happens — see
  // `syncSystemEvidenceForSession`'s `skipDuplicates` insert (§16).
  await prisma.edgeReviewCommitmentDailyState.upsert({
    where: { commitmentId_dateKey: { commitmentId, dateKey } },
    create: { userId, commitmentId, dateKey, status, source: "MANUAL", note: note ?? null },
    // A manual write clears any prior SYSTEM evidence for that day — the
    // trader's own account of the day replaces it entirely, never mixes
    // with a stale automated explanation for a different verdict.
    update: { status, source: "MANUAL", note: note ?? null, evidence: Prisma.JsonNull, relatedTradeId: null },
  });
}

export async function getCommitmentDailyStates(
  userId: string,
  commitmentIds: string[],
  dateKey: Date,
): Promise<Map<string, EdgeReviewCommitmentDailyStatus>> {
  if (commitmentIds.length === 0) return new Map();
  const rows = await prisma.edgeReviewCommitmentDailyState.findMany({
    where: { userId, commitmentId: { in: commitmentIds }, dateKey },
    select: { commitmentId: true, status: true },
  });
  return new Map(rows.map((r) => [r.commitmentId, r.status]));
}

/**
 * Bulk, N+1-safe adherence summary (Stage 19 §12 Today upgrade, §35) — for
 * each of the given commitments, its OWN lineage's current-period adherence
 * and trend, keyed by the id the caller passed in (not the lineage root),
 * so a Today panel with a handful of surfaced commitments needs exactly two
 * queries total, never one lineage walk per row.
 */
export async function getAdherenceSummaries(
  userId: string,
  commitments: { id: string; lineageId: string | null }[],
): Promise<Map<string, { current: ReturnType<typeof toAdherenceResultDTO>; trend: ReturnType<typeof classifyTrend> }>> {
  if (commitments.length === 0) return new Map();
  const rootIds = [...new Set(commitments.map((c) => c.lineageId ?? c.id))];

  const chain = await prisma.edgeReviewCommitment.findMany({
    where: { userId, OR: [{ id: { in: rootIds } }, { lineageId: { in: rootIds } }] },
    select: { id: true, lineageId: true, createdAt: true },
    orderBy: { createdAt: "asc" },
  });
  const dailyStateRows = await prisma.edgeReviewCommitmentDailyState.findMany({
    where: { commitmentId: { in: chain.map((c) => c.id) } },
    select: { commitmentId: true, dateKey: true, status: true },
  });
  const statesByCommitment = new Map<string, DailyStateForAdherence[]>(chain.map((c) => [c.id, []]));
  for (const s of dailyStateRows) {
    statesByCommitment.get(s.commitmentId)?.push({ dateKey: utcDateToKey(s.dateKey), status: s.status });
  }

  const chainByRoot = new Map<string, typeof chain>();
  for (const c of chain) {
    const root = c.lineageId ?? c.id;
    (chainByRoot.get(root) ?? chainByRoot.set(root, []).get(root)!).push(c);
  }

  const result = new Map<string, { current: ReturnType<typeof toAdherenceResultDTO>; trend: ReturnType<typeof classifyTrend> }>();
  for (const c of commitments) {
    const rootId = c.lineageId ?? c.id;
    const segments = (chainByRoot.get(rootId) ?? []).slice().sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
    const currentSegment = segments[segments.length - 1];
    const previousSegment = segments.length >= 2 ? segments[segments.length - 2] : null;
    const currentResult = computeAdherence(currentSegment ? (statesByCommitment.get(currentSegment.id) ?? []) : []);
    const previousResult = previousSegment ? computeAdherence(statesByCommitment.get(previousSegment.id) ?? []) : null;
    result.set(c.id, { current: toAdherenceResultDTO(currentResult), trend: classifyTrend(currentResult, previousResult) });
  }
  return result;
}

// ── Cross-period continuity & adherence (Stage 19 §3-14, §24-25) ───────────

/**
 * The full lineage for a commitment — every segment (the original commitment
 * plus every Continue/Refine successor), oldest first — with adherence
 * computed per segment, current/previous/lifetime, a deterministic trend
 * classification, and whether the lineage is a defensible candidate to
 * suggest resolving (never auto-resolved — §24). One indexed query for the
 * chain (`id = root OR lineageId = root`, §3) plus one for every segment's
 * daily states; everything else is in-memory, so this stays O(states in the
 * lineage) regardless of how many periods it has spanned.
 */
export async function getCommitmentLineage(userId: string, commitmentId: string): Promise<CommitmentLineageDTO> {
  const head = await prisma.edgeReviewCommitment.findFirst({ where: { id: commitmentId, userId } });
  if (!head) throw new Error("Commitment not found.");
  const rootId = effectiveLineageId(head);

  const chain = await prisma.edgeReviewCommitment.findMany({
    where: { userId, OR: [{ id: rootId }, { lineageId: rootId }] },
    orderBy: { createdAt: "asc" },
  });

  const dailyStateRows = await prisma.edgeReviewCommitmentDailyState.findMany({
    where: { commitmentId: { in: chain.map((c) => c.id) } },
    orderBy: { dateKey: "asc" },
  });
  const statesByCommitment = new Map<string, DailyStateForAdherence[]>(chain.map((c) => [c.id, []]));
  const observationsByCommitment = new Map<string, CommitmentObservationDTO[]>(chain.map((c) => [c.id, []]));
  for (const s of dailyStateRows) {
    statesByCommitment.get(s.commitmentId)?.push({ dateKey: utcDateToKey(s.dateKey), status: s.status });
    observationsByCommitment.get(s.commitmentId)?.push({
      dateKey: utcDateToKey(s.dateKey),
      status: s.status,
      source: s.source,
      note: s.note,
      evidenceDescription: evidenceDescriptionOf(s.evidence),
      relatedTradeId: s.relatedTradeId,
    });
  }

  const continuedFromIds = new Set(chain.map((c) => c.previousCommitmentId).filter((x): x is string => x != null));

  const segments = chain.map((c) => {
    const states = statesByCommitment.get(c.id) ?? [];
    return {
      commitmentId: c.id,
      title: c.title,
      description: c.description,
      category: c.category,
      periodStart: utcDateToKey(c.periodStart),
      reviewType: c.reviewType,
      status: c.status,
      adherence: toAdherenceResultDTO(computeAdherence(states)),
      retirementReason: c.status === "RETIRED" ? (continuedFromIds.has(c.id) ? ("SUPERSEDED" as const) : ("DISMISSED" as const)) : null,
      completedAt: c.completedAt?.toISOString() ?? null,
      retiredAt: c.retiredAt?.toISOString() ?? null,
      observations: observationsByCommitment.get(c.id) ?? [],
    };
  });

  const currentSegment = chain[chain.length - 1];
  const previousSegment = chain.length >= 2 ? chain[chain.length - 2] : null;
  const currentResult = computeAdherence(statesByCommitment.get(currentSegment.id) ?? []);
  const previousResult = previousSegment ? computeAdherence(statesByCommitment.get(previousSegment.id) ?? []) : null;

  const lifetimeStates = chain.flatMap((c) => statesByCommitment.get(c.id) ?? []);
  const lifetimeResult = computeAdherence(lifetimeStates);
  const chronological = [...lifetimeStates].sort((a, b) => (a.dateKey < b.dateKey ? -1 : a.dateKey > b.dateKey ? 1 : 0));
  const periodSamples = chain.map((c) => ({ periodStart: utcDateToKey(c.periodStart), result: computeAdherence(statesByCommitment.get(c.id) ?? []) }));

  return {
    lineageId: rootId,
    headCommitmentId: currentSegment.id,
    segments,
    current: toAdherenceResultDTO(currentResult),
    previous: previousResult ? toAdherenceResultDTO(previousResult) : null,
    lifetime: toAdherenceResultDTO(lifetimeResult),
    trend: classifyTrend(currentResult, previousResult),
    resolutionEligible: computeResolutionEligibility(lifetimeResult, periodSamples, chronological),
  };
}

function jsonInput(value: unknown): Prisma.InputJsonValue | typeof Prisma.JsonNull {
  return value === null || value === undefined ? Prisma.JsonNull : (value as Prisma.InputJsonValue);
}

/** Shared by Continue (§4, unchanged text) and Refine (§4, trader-edited
 *  text) — both retire `previousCommitmentId` and create one successor that
 *  inherits the lineage root, carrying its category/source/ruleKey/evidence
 *  forward untouched (Refine only ever changes title/description/category/
 *  priority, never the rule identity a commitment was built from). */
async function continueOrRefine(
  userId: string,
  previousCommitmentId: string,
  sessionId: string,
  overrides: { category?: EdgeReviewCommitmentCategory; title?: string; description?: string | null; priority?: EdgeReviewCommitmentPriority },
): Promise<EdgeReviewCommitmentDTO> {
  const previous = await prisma.edgeReviewCommitment.findFirst({ where: { id: previousCommitmentId, userId } });
  if (!previous) throw new Error("Commitment not found.");
  if (previous.status !== "ACTIVE") throw new Error("Only an active commitment can be continued.");

  const session = await ownedSession(userId, sessionId);
  const lineageId = effectiveLineageId(previous);

  const [, created] = await prisma.$transaction([
    prisma.edgeReviewCommitment.update({ where: { id: previous.id }, data: { status: "RETIRED", retiredAt: new Date() } }),
    prisma.edgeReviewCommitment.create({
      data: {
        userId,
        replayReviewSessionId: session.id,
        reviewType: session.reviewType,
        periodStart: session.startDate,
        category: overrides.category ?? previous.category,
        title: overrides.title ?? previous.title,
        description: overrides.description !== undefined ? overrides.description : previous.description,
        priority: overrides.priority ?? previous.priority,
        status: "ACTIVE",
        source: previous.source,
        sourceFindingType: previous.sourceFindingType,
        evidenceSnapshot: jsonInput(previous.evidenceSnapshot),
        previousCommitmentId: previous.id,
        lineageId,
      },
    }),
  ]);
  return toDTO(created);
}

/** §4 "Continue" — the same objective, unchanged, carried into a new period. */
export async function continueCommitment(userId: string, previousCommitmentId: string, sessionId: string): Promise<EdgeReviewCommitmentDTO> {
  return continueOrRefine(userId, previousCommitmentId, sessionId, {});
}

/** §4 "Refine" — the trader adjusts wording/scope while keeping the same
 *  lineage and rule identity; history of the prior wording is preserved on
 *  the retired predecessor row, never overwritten. */
export async function refineCommitment(
  userId: string,
  previousCommitmentId: string,
  sessionId: string,
  patch: { category: EdgeReviewCommitmentCategory; title: string; description: string | null; priority: EdgeReviewCommitmentPriority },
): Promise<EdgeReviewCommitmentDTO> {
  return continueOrRefine(userId, previousCommitmentId, sessionId, patch);
}

// ── Automatic evidence derivation (Stage 19 §10-11, §21, §42) ──────────────

/**
 * Runs once, at first finalization of a review (called from
 * `finalizeEdgeReview`, itself idempotent — see its own doc comment), for
 * every currently-ACTIVE commitment (in ANY lineage/period, not just this
 * session's own) whose `sourceFindingType` has a deterministic automatic-
 * evidence mapping (§21 — `hasAutomaticEvidenceRule`). Writes `SYSTEM`
 * daily-states from real Trade data (override discipline, overtrading,
 * risk-limit — the latter two from the Daily Market Plan's own per-day
 * boundaries) and already-computed Stage 15 discrepancy evidence
 * (stop-widening, premature-close, confirmed-missed-opportunity,
 * behaviour-label pattern) — nothing here recomputes those buckets
 * differently than the Comparison tab already shows (§25 reuse). Uses
 * `skipDuplicates` so a day that already has ANY row — MANUAL or an earlier
 * SYSTEM write — is left completely untouched (§16: system evidence can
 * never overwrite a trader's own entry, and never overwrites itself either,
 * keeping this function safely re-runnable). Degrades gracefully (§40) —
 * if the comparison can't be built yet (e.g. no ACTUAL baseline), the
 * discrepancy-derived rule keys simply produce no rows this run rather than
 * throwing; Replay is never forced to exist for this to succeed.
 */
export async function syncSystemEvidenceForSession(userId: string, sessionId: string): Promise<void> {
  const session = await prisma.replayReviewSession.findFirst({
    where: { id: sessionId, userId },
    select: { id: true, startDate: true, endDate: true },
  });
  if (!session) return;

  const activeCommitments = await prisma.edgeReviewCommitment.findMany({
    where: { userId, status: "ACTIVE", sourceFindingType: { not: null } },
    select: { id: true, sourceFindingType: true, periodStart: true },
  });
  const automatic = activeCommitments.filter((c) => hasAutomaticEvidenceRule(c.sourceFindingType));
  if (automatic.length === 0) return;

  type PendingRow = { userId: string; commitmentId: string; dateKey: Date; status: EdgeReviewCommitmentDailyStatus; source: "SYSTEM"; note: null; evidence: Prisma.InputJsonValue; relatedTradeId: string | null };
  const rows: PendingRow[] = [];

  function applyObservations(
    commitments: { id: string; periodStart: Date }[],
    observations: { dateKey: string; status: "FOLLOWED" | "BREACHED"; evidence: { description: string; category: string }; relatedTradeId: string | null }[],
  ) {
    for (const c of commitments) {
      const periodStartKey = utcDateToKey(c.periodStart);
      for (const o of observations) {
        if (o.dateKey < periodStartKey) continue; // never backdate evidence to before the objective existed
        rows.push({
          userId,
          commitmentId: c.id,
          dateKey: dateKeyToUtcDate(o.dateKey),
          status: o.status,
          source: "SYSTEM",
          note: null,
          evidence: o.evidence,
          relatedTradeId: o.relatedTradeId,
        });
      }
    }
  }

  const overrideRules = automatic.filter((c) => c.sourceFindingType === "OVERRIDE_DISCIPLINE");
  if (overrideRules.length > 0) {
    const trades = await prisma.trade.findMany({
      where: { userId, tradeDate: { gte: session.startDate, lte: session.endDate }, validationState: { not: null } },
      select: { id: true, tradeDate: true, validationState: true },
    });
    const observations = deriveOverrideDisciplineObservations(
      trades.map((t) => ({ id: t.id, dateKey: utcDateToKey(t.tradeDate), validationState: t.validationState })),
    );
    applyObservations(overrideRules, observations);
  }

  const stopWideningRules = automatic.filter((c) => c.sourceFindingType === "STOP_WIDENING_PATTERN");
  const prematureCloseRules = automatic.filter((c) => c.sourceFindingType === "PREMATURE_CLOSE_PATTERN");
  const missedOpportunityRules = automatic.filter((c) => c.sourceFindingType === "MISSED_OPPORTUNITY_DISCIPLINE");

  const behaviourLabelRules = automatic.filter((c) => c.sourceFindingType === "BEHAVIOUR_LABEL_PATTERN");

  if (stopWideningRules.length > 0 || prematureCloseRules.length > 0 || missedOpportunityRules.length > 0 || behaviourLabelRules.length > 0) {
    const comparison = await getReplayComparison(userId, sessionId).catch(() => null);
    if (comparison) {
      const executionEvents = comparison.discrepancy.executionDiscrepancy.events.map((e) => ({ dateKey: e.dateKey, category: e.category, description: e.description }));
      if (stopWideningRules.length > 0) applyObservations(stopWideningRules, deriveStopWideningObservations(executionEvents));
      if (prematureCloseRules.length > 0) applyObservations(prematureCloseRules, derivePrematureCloseObservations(executionEvents));
      if (missedOpportunityRules.length > 0) {
        const entries = comparison.discrepancy.opportunityDiscrepancy.entries.map((e) => ({ dateKey: e.dateKey, replayTradeId: e.replayTradeId }));
        applyObservations(missedOpportunityRules, deriveMissedOpportunityObservations(entries));
      }
      if (behaviourLabelRules.length > 0) {
        const behaviouralEvents = comparison.discrepancy.behavioralDiscrepancy.events.map((e) => ({ dateKey: e.dateKey, category: e.category, description: e.description }));
        applyObservations(behaviourLabelRules, deriveBehaviourLabelObservations(behaviouralEvents));
      }
    }
  }

  // Stage 19.1 §28-29 — overtrading/risk-limit, from the Daily Market Plan's
  // OWN per-day boundaries (`TradingDay.maxTradesPerDay`/`riskBudgetPercent`
  // — a day-level, trader-set fact, not a strategy default), compared
  // against that day's ACTUAL trade count / percent-based risk usage.
  const overtradingRules = automatic.filter((c) => c.sourceFindingType === "OVERTRADING_DISCIPLINE");
  const riskLimitRules = automatic.filter((c) => c.sourceFindingType === "RISK_LIMIT_DISCIPLINE");
  if (overtradingRules.length > 0 || riskLimitRules.length > 0) {
    const [days, trades] = await Promise.all([
      prisma.tradingDay.findMany({
        where: { userId, date: { gte: session.startDate, lte: session.endDate }, OR: [{ maxTradesPerDay: { not: null } }, { riskBudgetPercent: { not: null } }] },
        select: { date: true, maxTradesPerDay: true, riskBudgetPercent: true },
      }),
      prisma.trade.findMany({
        where: { userId, tradeDate: { gte: session.startDate, lte: session.endDate } },
        select: { tradeDate: true, allocations: { select: { riskInputType: true, riskValue: true } } },
      }),
    ]);

    const tradeCountByDay = new Map<string, number>();
    // A day's risk is only reliably measured if EVERY allocation that day is
    // percent-based — one non-percent allocation makes the whole day's sum
    // untrustworthy, so it's tracked as `null` (excluded) rather than an
    // understated partial total (§29 evidence test — no false positives).
    const riskByDay = new Map<string, number | null>();
    for (const t of trades) {
      const dk = utcDateToKey(t.tradeDate);
      tradeCountByDay.set(dk, (tradeCountByDay.get(dk) ?? 0) + 1);
      const allNonPercentSoFar = riskByDay.get(dk);
      if (allNonPercentSoFar === null) continue; // already disqualified
      const nonPercent = t.allocations.some((a) => a.riskInputType !== "PERCENT");
      if (nonPercent) {
        riskByDay.set(dk, null);
        continue;
      }
      const dayRisk = t.allocations.reduce((sum, a) => sum + a.riskValue.toNumber(), 0);
      riskByDay.set(dk, (allNonPercentSoFar ?? 0) + dayRisk);
    }

    if (overtradingRules.length > 0) {
      const overtradingDays = days
        .filter((d) => d.maxTradesPerDay != null)
        .map((d) => ({ dateKey: utcDateToKey(d.date), maxTradesPerDay: d.maxTradesPerDay!, tradeCount: tradeCountByDay.get(utcDateToKey(d.date)) ?? 0 }));
      applyObservations(overtradingRules, deriveOvertradingObservations(overtradingDays));
    }
    if (riskLimitRules.length > 0) {
      const riskDays = days
        .filter((d) => d.riskBudgetPercent != null)
        .map((d) => ({ dateKey: utcDateToKey(d.date), riskBudgetPercent: d.riskBudgetPercent!.toNumber(), riskUsedPercent: riskByDay.get(utcDateToKey(d.date)) ?? null }));
      applyObservations(riskLimitRules, deriveRiskLimitObservations(riskDays));
    }
  }

  if (rows.length === 0) return;
  await prisma.edgeReviewCommitmentDailyState.createMany({ data: rows, skipDuplicates: true });
}

// ── Trade Idea contextual reminders (Stage 19.1 §3-7) ───────────────────────

/**
 * The single active commitment (if any) matching one of the given
 * deterministic rule keys, for a compact, non-blocking reminder shown at
 * the moment the trader is about to repeat the targeted behavior — never a
 * keyword match over free text. Reuses `getActiveCommitmentsForToday`'s
 * exact weekly/monthly "latest finalized wins" + lineage/ruleKey dedup
 * (§6) so this can never disagree with what Today already shows, and adds
 * no new query beyond it. Returning a reminder is purely informational —
 * it creates no daily state and is not itself FOLLOWED/BREACHED evidence
 * (§7).
 */
export async function getContextualReminder(userId: string, ruleKeys: readonly string[]): Promise<ContextualReminderDTO | null> {
  const today = await getActiveCommitmentsForToday(userId);
  const match = [...today.weekly, ...today.monthly].find((c) => c.sourceFindingType != null && ruleKeys.includes(c.sourceFindingType));
  if (!match) return null;
  return { commitmentId: match.id, title: match.title, description: match.description, priority: match.priority, reviewType: match.reviewType };
}

// ── Analytics → Improvement (Stage 19.1 §14-21, §34-35) ─────────────────────

function emptyImprovementAnalytics(reviewType: ReplayReviewType): ImprovementAnalyticsDTO {
  return {
    reviewType,
    overview: { activeCount: 0, completedCount: 0, improvingCount: 0, decliningCount: 0, averageAdherencePercent: null, averageAdherenceSampleSize: 0 },
    mostBreached: null,
    longestRunning: null,
    rankings: [],
    behaviourOccurrence: [],
  };
}

/**
 * Canonical read model for Analytics → Improvement (§34) — the longitudinal
 * "did I actually improve" view, distinct from Edge → Improvements' own
 * per-period decision surface (§38). Scoped to ONE reviewType at a time
 * (§20 — weekly and monthly are different-duration series and are never
 * merged into one trend line; call this once per type and let the UI
 * toggle, same pattern as the existing Psychology Trend chart). Exactly two
 * queries regardless of how many commitments/lineages the user has (§35) —
 * everything else (lineage grouping, per-lineage current/previous/lifetime
 * adherence, trend, rankings, most-breached, longest-running, behaviour-
 * occurrence-per-period) is computed in memory from those two result sets,
 * reusing the SAME domain functions Stage 19 already uses — nothing here
 * recomputes adherence/trend differently (§34/§41).
 *
 * A lineage whose segments span BOTH weekly and monthly reviews (continued
 * across types) is intentionally represented separately in each type's own
 * dataset, built ONLY from that type's own segments — never a merged
 * cross-duration series (§20/§36 historical integrity: each segment's own
 * wording/status is preserved, never rewritten with the newest segment's).
 */
export async function buildImprovementAnalytics(userId: string, reviewType: ReplayReviewType): Promise<ImprovementAnalyticsDTO> {
  const commitments = await prisma.edgeReviewCommitment.findMany({
    where: { userId, reviewType },
    select: { id: true, lineageId: true, previousCommitmentId: true, title: true, category: true, status: true, sourceFindingType: true, periodStart: true, createdAt: true },
    orderBy: { createdAt: "asc" },
  });
  if (commitments.length === 0) return emptyImprovementAnalytics(reviewType);

  const dailyStateRows = await prisma.edgeReviewCommitmentDailyState.findMany({
    where: { commitmentId: { in: commitments.map((c) => c.id) } },
    select: { commitmentId: true, dateKey: true, status: true },
  });
  const statesByCommitment = new Map<string, DailyStateForAdherence[]>(commitments.map((c) => [c.id, []]));
  for (const s of dailyStateRows) {
    statesByCommitment.get(s.commitmentId)?.push({ dateKey: utcDateToKey(s.dateKey), status: s.status });
  }

  const byLineage = new Map<string, typeof commitments>();
  for (const c of commitments) {
    const root = c.lineageId ?? c.id;
    const list = byLineage.get(root);
    if (list) list.push(c);
    else byLineage.set(root, [c]);
  }

  let activeCount = 0;
  let completedCount = 0;
  let improvingCount = 0;
  let decliningCount = 0;
  let adherenceSum = 0;
  let adherenceSampleSize = 0;
  const rankings: ImprovementAnalyticsDTO["rankings"] = [];
  let mostBreached: ImprovementAnalyticsDTO["mostBreached"] = null;
  let longestRunning: ImprovementAnalyticsDTO["longestRunning"] = null;
  // ruleKey -> periodStart -> breach count, for the behaviour-occurrence series (§19).
  const breachesByRule = new Map<string, Map<string, number>>();

  for (const segments of byLineage.values()) {
    const ordered = [...segments].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
    const head = ordered[ordered.length - 1];
    const previousSegment = ordered.length >= 2 ? ordered[ordered.length - 2] : null;
    const lineageId = head.lineageId ?? head.id;

    const lifetimeStates = ordered.flatMap((s) => statesByCommitment.get(s.id) ?? []);
    const lifetime = computeAdherence(lifetimeStates);
    const currentResult = computeAdherence(statesByCommitment.get(head.id) ?? []);
    const previousResult = previousSegment ? computeAdherence(statesByCommitment.get(previousSegment.id) ?? []) : null;
    const trend = classifyTrend(currentResult, previousResult);

    if (head.status === "ACTIVE") activeCount += 1;
    if (head.status === "COMPLETED") completedCount += 1;
    if (trend === "IMPROVING") improvingCount += 1;
    if (trend === "DECLINING") decliningCount += 1;

    if (lifetime.applicableObservations > 0) {
      adherenceSum += lifetime.adherence!;
      adherenceSampleSize += 1;
      if (lifetime.breached > 0 && (!mostBreached || lifetime.breached > mostBreached.breachCount)) {
        mostBreached = {
          lineageId,
          title: head.title,
          category: head.category,
          breachCount: lifetime.breached,
          applicableObservations: lifetime.applicableObservations,
          adherencePercent: Math.round(lifetime.adherence! * 100),
        };
      }
    }

    if (head.status === "ACTIVE") {
      const periodsActive = ordered.length;
      if (!longestRunning || periodsActive > longestRunning.periodsActive) {
        longestRunning = { lineageId, title: head.title, category: head.category, periodsActive, firstIdentifiedDateKey: utcDateToKey(ordered[0].periodStart) };
      }
      rankings.push({
        lineageId,
        headCommitmentId: head.id,
        title: head.title,
        category: head.category,
        current: toAdherenceResultDTO(currentResult),
        previous: previousResult ? toAdherenceResultDTO(previousResult) : null,
        trend,
        periodsActive,
      });
    }

    if (head.sourceFindingType && hasAutomaticEvidenceRule(head.sourceFindingType)) {
      const perPeriod = breachesByRule.get(head.sourceFindingType) ?? new Map<string, number>();
      for (const seg of ordered) {
        const breachCount = (statesByCommitment.get(seg.id) ?? []).filter((s) => s.status === "BREACHED").length;
        if (breachCount === 0) continue;
        const periodStart = utcDateToKey(seg.periodStart);
        perPeriod.set(periodStart, (perPeriod.get(periodStart) ?? 0) + breachCount);
      }
      if (perPeriod.size > 0) breachesByRule.set(head.sourceFindingType, perPeriod);
    }
  }

  const behaviourOccurrence = [...breachesByRule.entries()]
    .map(([ruleKey, points]) => ({
      ruleKey,
      points: [...points.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([periodStart, breachCount]) => ({ periodStart, breachCount })),
    }))
    .sort((a, b) => a.ruleKey.localeCompare(b.ruleKey));

  rankings.sort((a, b) => a.title.localeCompare(b.title));

  return {
    reviewType,
    overview: {
      activeCount,
      completedCount,
      improvingCount,
      decliningCount,
      averageAdherencePercent: adherenceSampleSize > 0 ? Math.round((adherenceSum / adherenceSampleSize) * 100) : null,
      averageAdherenceSampleSize: adherenceSampleSize,
    },
    mostBreached,
    longestRunning,
    rankings,
    behaviourOccurrence,
  };
}
