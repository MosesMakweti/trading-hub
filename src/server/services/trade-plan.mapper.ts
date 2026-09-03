import { mediaUrl } from "@/server/services/media.service";
import type { getPlanWorkspace } from "@/server/services/trade-plan.service";
import type {
  PlanAnnotationDTO,
  PlannedTargetDTO,
  PlanScreenshotDTO,
  PlanVersionDTO,
  PlanWorkspaceDTO,
  RecognitionFieldDTO,
} from "@/types/trade-plan";

type WorkspaceRaw = Awaited<ReturnType<typeof getPlanWorkspace>>;

function toRecognitionFieldDTO(field: NonNullable<WorkspaceRaw["screenshot"]>["recognitionFields"][number]): RecognitionFieldDTO {
  return {
    id: field.id,
    fieldType: field.fieldType,
    targetOrder: field.targetOrder,
    rawExtractedText: field.rawExtractedText,
    detectedValue: field.detectedValue,
    confidence: field.confidence,
    boundingBox: (field.boundingBox as RecognitionFieldDTO["boundingBox"] | null) ?? null,
    recognitionSource: field.recognitionSource,
    warning: field.warning,
    confirmationStatus: field.confirmationStatus,
    confirmedValue: field.confirmedValue,
  };
}

function toAnnotationDTO(a: NonNullable<WorkspaceRaw["screenshot"]>["annotations"][number]): PlanAnnotationDTO {
  return {
    id: a.id,
    type: a.type,
    label: a.label,
    confirmedPrice: a.confirmedPrice?.toNumber() ?? null,
    y: a.y,
    startX: a.startX,
    endX: a.endX,
    endY: a.endY,
    color: a.color,
    visible: a.visible,
    targetOrder: a.targetOrder,
    confidence: a.confidence,
    source: a.source,
  };
}

function toScreenshotDTO(screenshot: NonNullable<WorkspaceRaw["screenshot"]>): PlanScreenshotDTO {
  return {
    id: screenshot.id,
    tradeId: screenshot.tradeId,
    mediaAssetId: screenshot.mediaAssetId,
    imageUrl: mediaUrl(screenshot.mediaAssetId),
    previewImageUrl: screenshot.previewMediaAssetId ? mediaUrl(screenshot.previewMediaAssetId) : null,
    width: screenshot.width,
    height: screenshot.height,
    status: screenshot.status,
    recognitionProvider: screenshot.recognitionProvider,
    recognitionError: screenshot.recognitionError,
    detectedSymbol: screenshot.detectedSymbol,
    canonicalInstrumentSymbol: screenshot.canonicalInstrumentSymbol,
    detectedTimeframe: screenshot.detectedTimeframe,
    detectedDirection: screenshot.detectedDirection,
    uploadedAt: screenshot.uploadedAt.toISOString(),
    confirmedAt: screenshot.confirmedAt?.toISOString() ?? null,
    lockedAt: screenshot.lockedAt?.toISOString() ?? null,
    recognitionFields: screenshot.recognitionFields.map(toRecognitionFieldDTO),
    annotations: screenshot.annotations.map(toAnnotationDTO),
  };
}

function toTargetDTO(t: WorkspaceRaw["targets"][number]): PlannedTargetDTO {
  return {
    id: t.id,
    targetOrder: t.targetOrder,
    label: t.label,
    targetPrice: t.targetPrice.toNumber(),
    unitDistance: t.unitDistance?.toNumber() ?? null,
    unitType: t.unitType,
    rMultiple: t.rMultiple?.toNumber() ?? null,
    plannedClosePercent: t.plannedClosePercent?.toNumber() ?? null,
    managementInstruction: t.managementInstruction,
    moveToBreakEven: t.moveToBreakEven,
    notes: t.notes,
  };
}

function toVersionDTO(v: WorkspaceRaw["versions"][number]): PlanVersionDTO {
  return {
    id: v.id,
    versionNumber: v.versionNumber,
    assetSymbol: v.assetSymbol,
    direction: v.direction,
    timeframe: v.timeframe,
    entry: v.entry?.toNumber() ?? null,
    stopLoss: v.stopLoss?.toNumber() ?? null,
    stopDistance: v.stopDistance?.toNumber() ?? null,
    stopDistanceUnit: v.stopDistanceUnit,
    weightedPlannedR: v.weightedPlannedR?.toNumber() ?? null,
    editReason: v.editReason,
    locked: v.locked,
    createdAt: v.createdAt.toISOString(),
    screenshotImageUrl: v.screenshotMediaAssetId ? mediaUrl(v.screenshotMediaAssetId) : null,
    annotations: Array.isArray(v.annotationsSnapshot) ? (v.annotationsSnapshot as unknown as PlanVersionDTO["annotations"]) : [],
    targets: Array.isArray(v.targetsSnapshot) ? (v.targetsSnapshot as unknown as PlanVersionDTO["targets"]) : [],
  };
}

export function toPlanWorkspaceDTO(raw: WorkspaceRaw): PlanWorkspaceDTO {
  return {
    screenshot: raw.screenshot ? toScreenshotDTO(raw.screenshot) : null,
    targets: raw.targets.map(toTargetDTO),
    versions: raw.versions.map(toVersionDTO),
    isLocked: raw.versions[0]?.locked ?? false,
  };
}
