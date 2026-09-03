import type { AnnotationType } from "@prisma/client";

import { prisma, type TransactionClient } from "@/server/db";
import { readMediaFile } from "@/lib/media-storage";
import { computeDistance } from "@/domain/trade-plan/distance";
import { computeTargetRMultiples, computeWeightedPlannedR } from "@/domain/trade-plan/planned-rr";
import { hasBlockingIssues, validatePlan } from "@/domain/trade-plan/plan-validation";
import { lookupInstrument, parseSymbol } from "@/domain/trade-plan/instrument-catalog";
import { NullRecognitionProvider, type ScreenshotRecognitionProvider } from "@/domain/trade-plan/recognition-types";
import { ClaudeVisionRecognitionProvider } from "@/domain/trade-plan/providers/claude-vision-provider";
import type { ConfirmPlanInput, RevisePlanInput, AnnotationUpsertInput } from "@/lib/validation/trade-plan";

/**
 * TradingView Screenshot Trade Plan — server orchestration. Reuses the
 * universal media system for file storage (a screenshot is always a normal
 * MediaAsset the trader already uploaded via /api/media/upload with
 * ownerType=TRADE, category="BEFORE" — this service only ever wraps an
 * asset id the trader already owns, it never writes files itself) and
 * domain/prop-firms/risk.ts's computePlannedR (via domain/trade-plan/
 * planned-rr.ts) for the R:R formula — no parallel storage or math system.
 */

// ── Provider resolution (spec §3: provider-agnostic, no hardcoded secrets) ──

/** Prefers the Claude vision provider, gated on its own `isAvailable()`
 *  (i.e. `ANTHROPIC_API_KEY` set — never a hardcoded credential) and falls
 *  back to the Null provider otherwise, so "recognition unavailable" stays a
 *  real, exercised path in workspaces without the key configured. */
function resolveRecognitionProvider(): ScreenshotRecognitionProvider {
  const claudeVision = new ClaudeVisionRecognitionProvider();
  return claudeVision.isAvailable() ? claudeVision : new NullRecognitionProvider();
}

async function assertOwnsTrade(userId: string, tradeId: string) {
  const trade = await prisma.trade.findFirst({ where: { id: tradeId, userId } });
  if (!trade) throw new Error("Trade not found.");
  return trade;
}

function resolveInstrumentSpec(assetSymbol: string) {
  return parseSymbol(assetSymbol).spec ?? lookupInstrument(assetSymbol);
}

// ── Screenshot attach / replace / remove ─────────────────────────────────────

async function assertScreenshotEditable(screenshot: { status: string } | null) {
  if (screenshot && screenshot.status === "LOCKED") {
    throw new Error("This trade's plan is locked. Use the revise flow with an edit reason to change it.");
  }
}

/** Wraps a MediaAsset the trader already owns (just uploaded, or picked from
 *  an existing Before-Trade image) into this trade's TradePlanScreenshot —
 *  creating it fresh, or replacing the current one when called again.
 *
 * Unlike removePlanScreenshot/runRecognition/annotation edits, replacing IS
 * allowed on a locked plan (checkpoint 2 §2: the trader must be able to
 * "replace Screenshot A with Screenshot B" as part of revising an executed
 * trade's plan). This is safe because history no longer depends on the live
 * TradePlanScreenshot/TradePlanAnnotation rows surviving: every confirmed
 * TradePlanVersion already freezes its own screenshotMediaAssetId (the
 * underlying MediaAsset is never deleted by this function, only the
 * wrapper row is) and annotationsSnapshot (see savePlan). Replacing here
 * only changes what the CURRENTLY-EDITABLE draft points at; it does not
 * touch any past version. The screenshot's status is reset to UPLOADED and
 * only becomes LOCKED again once the trader calls savePlan with an edit
 * reason (which re-applies `inheritsLock`). */
export async function attachPlanScreenshot(
  userId: string,
  tradeId: string,
  mediaAssetId: string,
  dimensions: { width?: number | null; height?: number | null } = {},
) {
  await assertOwnsTrade(userId, tradeId);
  const asset = await prisma.mediaAsset.findFirst({ where: { id: mediaAssetId, userId } });
  if (!asset) throw new Error("Image not found or access denied.");

  const existing = await prisma.tradePlanScreenshot.findFirst({ where: { tradeId, userId, deletedAt: null } });

  return prisma.$transaction(async (tx) => {
    if (existing) {
      // Drop the old wrapper (and whatever recognition/annotations it had —
      // both are already frozen into any TradePlanVersion that used them,
      // see savePlan's annotationsSnapshot). The underlying MediaAsset/
      // Attachment for the OLD image is left alone (it may still be a plain
      // before-trade reference image, and old TradePlanVersion rows resolve
      // it directly by id regardless of this wrapper's lifetime).
      await tx.tradePlanScreenshot.delete({ where: { id: existing.id } });
    }
    return tx.tradePlanScreenshot.create({
      data: {
        userId,
        tradeId,
        mediaAssetId,
        width: dimensions.width ?? null,
        height: dimensions.height ?? null,
        status: "UPLOADED",
      },
    });
  });
}

/** Same as attachPlanScreenshot, but resolves an existing Before-Trade
 *  MediaAttachment to its underlying asset first (spec §1: "Selecting an
 *  already uploaded before-trade screenshot"). */
export async function attachPlanScreenshotFromExisting(userId: string, tradeId: string, mediaAttachmentId: string) {
  const attachment = await prisma.mediaAttachment.findFirst({
    where: { id: mediaAttachmentId, ownerType: "TRADE", ownerId: tradeId, category: "BEFORE", media: { userId } },
    select: { mediaId: true },
  });
  if (!attachment) throw new Error("Image not found or access denied.");
  return attachPlanScreenshot(userId, tradeId, attachment.mediaId);
}

/** Removes the plan screenshot wrapper before confirmation (spec §1). The
 *  underlying image file/attachment is untouched — only the plan-specific
 *  wrapper (and its recognition/annotation data) goes away. */
export async function removePlanScreenshot(userId: string, tradeId: string): Promise<void> {
  const existing = await prisma.tradePlanScreenshot.findFirst({ where: { tradeId, userId, deletedAt: null } });
  if (!existing) return;
  await assertScreenshotEditable(existing);
  await prisma.tradePlanScreenshot.delete({ where: { id: existing.id } });
}

// ── Recognition ───────────────────────────────────────────────────────────

export interface RunRecognitionResult {
  status: "RECOGNITION_COMPLETE" | "RECOGNITION_FAILED";
  error?: string;
}

/** Runs the configured recognition provider (today: always the Null
 *  provider — see resolveRecognitionProvider) against the trade's
 *  screenshot, persisting structured ScreenshotRecognitionField rows on
 *  success. Recognition failure is never thrown to the caller as an
 *  exception — it's a normal, expected outcome the trader proceeds past
 *  manually (spec §2). */
export async function runRecognition(userId: string, tradeId: string): Promise<RunRecognitionResult> {
  const screenshot = await prisma.tradePlanScreenshot.findFirst({
    where: { tradeId, userId, deletedAt: null },
    include: { mediaAsset: true },
  });
  if (!screenshot) throw new Error("No screenshot to analyze.");
  await assertScreenshotEditable(screenshot);

  await prisma.tradePlanScreenshot.update({ where: { id: screenshot.id }, data: { status: "PROCESSING" } });

  const provider = resolveRecognitionProvider();

  if (!provider.isAvailable()) {
    await prisma.tradePlanScreenshot.update({
      where: { id: screenshot.id },
      data: { status: "RECOGNITION_FAILED", recognitionError: "Recognition provider unavailable.", processedAt: new Date() },
    });
    return { status: "RECOGNITION_FAILED", error: "Recognition provider unavailable." };
  }

  let imageBuffer: Buffer;
  try {
    imageBuffer = await readMediaFile(screenshot.mediaAsset.storageKey);
  } catch {
    await prisma.tradePlanScreenshot.update({
      where: { id: screenshot.id },
      data: { status: "RECOGNITION_FAILED", recognitionError: "Could not read the uploaded image.", processedAt: new Date() },
    });
    return { status: "RECOGNITION_FAILED", error: "Could not read the uploaded image." };
  }

  const outcome = await provider.recognize({ imageBuffer, mimeType: screenshot.mediaAsset.mimeType });

  if (outcome.status === "RECOGNITION_FAILED") {
    await prisma.tradePlanScreenshot.update({
      where: { id: screenshot.id },
      data: {
        status: "RECOGNITION_FAILED",
        recognitionError: outcome.error,
        recognitionProvider: provider.name,
        recognitionVersion: provider.version,
        processedAt: new Date(),
      },
    });
    return { status: "RECOGNITION_FAILED", error: outcome.error };
  }

  const symbolField = outcome.fields.find((f) => f.fieldType === "SYMBOL");
  const parsed = symbolField?.detectedValue ? parseSymbol(symbolField.detectedValue) : null;
  const directionField = outcome.fields.find((f) => f.fieldType === "DIRECTION")?.detectedValue;

  await prisma.$transaction(async (tx) => {
    await tx.screenshotRecognitionField.deleteMany({ where: { screenshotId: screenshot.id } });
    for (const field of outcome.fields) {
      await tx.screenshotRecognitionField.create({
        data: {
          screenshotId: screenshot.id,
          fieldType: field.fieldType,
          targetOrder: field.targetOrder ?? null,
          rawExtractedText: field.rawExtractedText ?? null,
          detectedValue: field.detectedValue,
          confidence: field.confidence ?? null,
          boundingBox: field.boundingBox ?? undefined,
          recognitionSource: "AI_VISION",
          warning: field.warning ?? null,
        },
      });
    }
    await tx.tradePlanScreenshot.update({
      where: { id: screenshot.id },
      data: {
        status: "NEEDS_CONFIRMATION",
        recognitionProvider: provider.name,
        recognitionVersion: provider.version,
        recognitionError: null,
        detectedSymbol: symbolField?.detectedValue ?? null,
        canonicalInstrumentSymbol: parsed?.spec?.canonicalSymbol ?? null,
        detectedTimeframe: outcome.fields.find((f) => f.fieldType === "TIMEFRAME")?.detectedValue ?? null,
        detectedDirection: directionField === "LONG" || directionField === "SHORT" ? directionField : null,
        processedAt: new Date(),
      },
    });
  });

  return { status: "RECOGNITION_COMPLETE" };
}

// ── Annotations ───────────────────────────────────────────────────────────

export async function upsertAnnotation(userId: string, tradeId: string, input: AnnotationUpsertInput) {
  const screenshot = await prisma.tradePlanScreenshot.findFirst({ where: { tradeId, userId, deletedAt: null } });
  if (!screenshot) throw new Error("No screenshot for this trade.");
  await assertScreenshotEditable(screenshot);

  const data = {
    screenshotId: screenshot.id,
    type: input.type as AnnotationType,
    label: input.label,
    confirmedPrice: input.confirmedPrice != null ? input.confirmedPrice.toString() : null,
    y: input.y,
    startX: input.startX ?? null,
    endX: input.endX ?? null,
    endY: input.endY ?? null,
    color: input.color,
    visible: input.visible ?? true,
    targetOrder: input.targetOrder ?? null,
    source: "MANUAL" as const,
  };

  if (input.id) {
    const existing = await prisma.tradePlanAnnotation.findFirst({ where: { id: input.id, screenshotId: screenshot.id } });
    if (!existing) throw new Error("Annotation not found.");
    return prisma.tradePlanAnnotation.update({ where: { id: input.id }, data });
  }
  return prisma.tradePlanAnnotation.create({ data });
}

export async function deleteAnnotation(userId: string, tradeId: string, annotationId: string): Promise<void> {
  const screenshot = await prisma.tradePlanScreenshot.findFirst({ where: { tradeId, userId, deletedAt: null } });
  if (!screenshot) return;
  await assertScreenshotEditable(screenshot);
  await prisma.tradePlanAnnotation.deleteMany({ where: { id: annotationId, screenshotId: screenshot.id } });
}

/** Clears every recognition-detected annotation, leaving manually-created
 *  ones untouched (spec §7: "Reset detected annotations"). */
export async function resetDetectedAnnotations(userId: string, tradeId: string): Promise<void> {
  const screenshot = await prisma.tradePlanScreenshot.findFirst({ where: { tradeId, userId, deletedAt: null } });
  if (!screenshot) return;
  await assertScreenshotEditable(screenshot);
  await prisma.tradePlanAnnotation.deleteMany({ where: { screenshotId: screenshot.id, source: "DETECTED" } });
}

// ── Plan confirmation / revision (spec §10/§11/§13) ──────────────────────────

export interface SavePlanResult {
  issues: ReturnType<typeof validatePlan>;
  versionNumber: number;
}

/** Confirms (first time) or revises (locked plan + edit reason) a trade's
 *  plan in one place — the only difference is whether an editReason is
 *  required and whether the new version inherits `locked: true`. Computes
 *  every distance/R value fresh from the CONFIRMED prices (never from a
 *  screenshot's pixel positions — spec §7) and writes:
 *    - Trade.plannedEntry/plannedStopLoss/plannedTarget/timeframe/direction
 *      (the legacy single-target trio stays in sync with target #1 for every
 *      existing reader of those columns)
 *    - Trade.expectedRR (the weighted planned R across all targets — the
 *      trade's Expected RR is no longer manually entered anywhere; this is
 *      its only source, null until a plan is first confirmed)
 *    - PlannedTarget[] (full replace — the live, editable set)
 *    - TradePlanVersion (append-only snapshot history)
 *    - TradePlanScreenshot.status -> CONFIRMED, when a screenshot exists
 */
export async function savePlan(
  userId: string,
  tradeId: string,
  input: ConfirmPlanInput | RevisePlanInput,
): Promise<SavePlanResult> {
  const trade = await assertOwnsTrade(userId, tradeId);
  const screenshot = await prisma.tradePlanScreenshot.findFirst({
    where: { tradeId, userId, deletedAt: null },
    include: { annotations: true },
  });

  const lastVersion = await prisma.tradePlanVersion.findFirst({ where: { tradeId }, orderBy: { versionNumber: "desc" } });
  const editReason = "editReason" in input ? input.editReason : null;
  if (lastVersion?.locked && !editReason) {
    throw new Error("This plan is locked. Provide an edit reason to save a revision.");
  }

  const spec = resolveInstrumentSpec(trade.assetSymbol);
  const targetsForCalc = input.targets.map((t) => ({
    targetOrder: t.targetOrder,
    targetPrice: t.targetPrice,
    plannedClosePercent: t.plannedClosePercent ?? null,
  }));

  const issues = validatePlan({
    direction: input.direction,
    entry: input.entry,
    stopLoss: input.stopLoss,
    targets: targetsForCalc,
    maxDecimalPrecision: spec?.decimalPrecision ?? null,
  });
  if (hasBlockingIssues(issues)) {
    throw new Error(issues.filter((i) => i.severity === "error").map((i) => i.message).join(" "));
  }

  const stopDist = computeDistance(input.entry, input.stopLoss, spec);
  const targetRs = computeTargetRMultiples(input.direction, input.entry, input.stopLoss, targetsForCalc);
  const weighted = computeWeightedPlannedR(targetRs, targetsForCalc);

  const versionNumber = (lastVersion?.versionNumber ?? 0) + 1;
  const inheritsLock = lastVersion?.locked ?? false;

  const targetsSnapshot = input.targets.map((t) => {
    const dist = computeDistance(input.entry, t.targetPrice, spec);
    const r = targetRs.find((x) => x.targetOrder === t.targetOrder);
    return {
      targetOrder: t.targetOrder,
      label: t.label,
      targetPrice: t.targetPrice,
      unitDistance: dist.distance.toNumber(),
      unitType: dist.unit,
      rMultiple: r?.rMultiple?.toNumber() ?? null,
      plannedClosePercent: t.plannedClosePercent ?? null,
    };
  });

  // Freeze the CURRENT annotations exactly as they are right now — this is
  // what lets a later screenshot replacement (attachPlanScreenshot cascades
  // away the live TradePlanAnnotation rows) never affect what THIS version
  // displays when reopened later (checkpoint 2 §2).
  const annotationsSnapshot = (screenshot?.annotations ?? []).map((a) => ({
    type: a.type,
    label: a.label,
    confirmedPrice: a.confirmedPrice?.toNumber() ?? null,
    y: a.y,
    startX: a.startX,
    endX: a.endX,
    endY: a.endY,
    color: a.color,
    targetOrder: a.targetOrder,
    source: a.source,
  }));

  await prisma.$transaction(async (tx: TransactionClient) => {
    await tx.plannedTarget.deleteMany({ where: { tradeId } });
    for (const t of input.targets) {
      const dist = computeDistance(input.entry, t.targetPrice, spec);
      const r = targetRs.find((x) => x.targetOrder === t.targetOrder);
      await tx.plannedTarget.create({
        data: {
          tradeId,
          targetOrder: t.targetOrder,
          label: t.label,
          targetPrice: t.targetPrice.toString(),
          unitDistance: dist.distance.toString(),
          unitType: dist.unit,
          rMultiple: r?.rMultiple?.toString() ?? null,
          plannedClosePercent: t.plannedClosePercent ?? null,
          managementInstruction: t.managementInstruction ?? null,
          moveToBreakEven: t.moveToBreakEven ?? false,
          notes: t.notes ?? null,
        },
      });
    }

    const firstTarget = input.targets.find((t) => t.targetOrder === 1) ?? input.targets[0];
    await tx.trade.update({
      where: { id: tradeId },
      data: {
        direction: input.direction,
        plannedEntry: input.entry.toString(),
        plannedStopLoss: input.stopLoss.toString(),
        plannedTarget: firstTarget.targetPrice.toString(),
        expectedRR: weighted.weightedR?.toString() ?? null,
        timeframe: input.timeframe ?? null,
      },
    });

    if (screenshot) {
      // A revision of an already-locked plan (inheritsLock) stays LOCKED —
      // saving a revision must never regress the screenshot back to
      // "just confirmed, not yet executed" when the trade already has.
      await tx.tradePlanScreenshot.update({
        where: { id: screenshot.id },
        data: {
          status: inheritsLock ? "LOCKED" : "CONFIRMED",
          confirmedAt: screenshot.confirmedAt ?? new Date(),
        },
      });
    }

    await tx.tradePlanVersion.create({
      data: {
        tradeId,
        versionNumber,
        screenshotMediaAssetId: screenshot?.mediaAssetId ?? null,
        assetSymbol: trade.assetSymbol,
        direction: input.direction,
        timeframe: input.timeframe ?? null,
        entry: input.entry.toString(),
        stopLoss: input.stopLoss.toString(),
        targetsSnapshot,
        annotationsSnapshot,
        stopDistance: stopDist.distance.toString(),
        stopDistanceUnit: stopDist.unit,
        weightedPlannedR: weighted.weightedR?.toString() ?? null,
        editReason,
        createdByUserId: userId,
        locked: inheritsLock,
      },
    });
  });

  return { issues, versionNumber };
}

/** Marks the trade's plan as locked — called once, the moment the trader
 *  first records an actual entry or otherwise begins execution (spec §13).
 *  A no-op if there's no confirmed plan yet, or it's already locked. */
export async function lockPlanIfConfirmedAndUnlocked(userId: string, tradeId: string): Promise<void> {
  const latest = await prisma.tradePlanVersion.findFirst({
    where: { tradeId, trade: { userId } },
    orderBy: { versionNumber: "desc" },
  });
  if (!latest || latest.locked) return;

  await prisma.$transaction(async (tx) => {
    await tx.tradePlanVersion.update({ where: { id: latest.id }, data: { locked: true } });
    await tx.tradePlanScreenshot.updateMany({
      where: { tradeId, deletedAt: null },
      data: { status: "LOCKED", lockedAt: new Date() },
    });
  });
}

// ── Read model ────────────────────────────────────────────────────────────

export async function getPlanWorkspace(userId: string, tradeId: string) {
  await assertOwnsTrade(userId, tradeId);
  const [screenshot, targets, versions] = await Promise.all([
    prisma.tradePlanScreenshot.findFirst({
      where: { tradeId, userId, deletedAt: null },
      include: {
        mediaAsset: true,
        previewMediaAsset: true,
        recognitionFields: { orderBy: { fieldType: "asc" } },
        annotations: { orderBy: { createdAt: "asc" } },
      },
    }),
    prisma.plannedTarget.findMany({ where: { tradeId }, orderBy: { targetOrder: "asc" } }),
    prisma.tradePlanVersion.findMany({ where: { tradeId }, orderBy: { versionNumber: "desc" } }),
  ]);
  return { screenshot, targets, versions };
}

/** Best-effort instrument spec for a trade's own assetSymbol — used by the
 *  UI to show the resolved pip/tick/point unit before the trader saves. */
export function resolveInstrumentSpecForSymbol(assetSymbol: string) {
  return resolveInstrumentSpec(assetSymbol);
}
