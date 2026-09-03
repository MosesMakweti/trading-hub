// TradingView Screenshot Trade Plan — client-shared DTOs. Mirrors the
// pattern in types/prop-firms.ts: plain serializable shapes only (Decimal ->
// number at the mapper edge), safe to import from client components.

export interface RecognitionFieldDTO {
  id: string;
  fieldType: string;
  targetOrder: number | null;
  rawExtractedText: string | null;
  detectedValue: string | null;
  confidence: number | null;
  boundingBox: { x: number; y: number; width: number; height: number } | null;
  recognitionSource: string;
  warning: string | null;
  confirmationStatus: string;
  confirmedValue: string | null;
}

export interface PlanAnnotationDTO {
  id: string;
  type: string;
  label: string;
  confirmedPrice: number | null;
  y: number;
  startX: number | null;
  endX: number | null;
  endY: number | null;
  color: string;
  visible: boolean;
  targetOrder: number | null;
  confidence: number | null;
  source: string;
}

export interface PlanScreenshotDTO {
  id: string;
  tradeId: string;
  mediaAssetId: string;
  imageUrl: string;
  previewImageUrl: string | null;
  width: number | null;
  height: number | null;
  status: string;
  recognitionProvider: string | null;
  recognitionError: string | null;
  detectedSymbol: string | null;
  canonicalInstrumentSymbol: string | null;
  detectedTimeframe: string | null;
  detectedDirection: string | null;
  uploadedAt: string;
  confirmedAt: string | null;
  lockedAt: string | null;
  recognitionFields: RecognitionFieldDTO[];
  annotations: PlanAnnotationDTO[];
}

export interface PlannedTargetDTO {
  id: string;
  targetOrder: number;
  label: string;
  targetPrice: number;
  unitDistance: number | null;
  unitType: string | null;
  rMultiple: number | null;
  plannedClosePercent: number | null;
  managementInstruction: string | null;
  moveToBreakEven: boolean;
  notes: string | null;
}

export interface PlanVersionDTO {
  id: string;
  versionNumber: number;
  assetSymbol: string | null;
  direction: string | null;
  timeframe: string | null;
  entry: number | null;
  stopLoss: number | null;
  stopDistance: number | null;
  stopDistanceUnit: string | null;
  weightedPlannedR: number | null;
  editReason: string | null;
  locked: boolean;
  createdAt: string;
  /** The exact screenshot in effect at THIS version — resolved from the
   *  frozen MediaAsset id, independent of whatever the trade's current/live
   *  screenshot is now. Null when this version had no screenshot. */
  screenshotImageUrl: string | null;
  /** Frozen annotation lines exactly as they looked at this version's save
   *  time — never affected by a later screenshot replacement. */
  annotations: {
    type: string;
    label: string;
    confirmedPrice: number | null;
    y: number;
    startX: number | null;
    endX: number | null;
    endY: number | null;
    color: string;
    targetOrder: number | null;
  }[];
  /** Frozen target list exactly as confirmed at this version. */
  targets: {
    targetOrder: number;
    label: string;
    targetPrice: number;
    unitDistance: number | null;
    unitType: string | null;
    rMultiple: number | null;
    plannedClosePercent: number | null;
  }[];
}

export interface PlanWorkspaceDTO {
  screenshot: PlanScreenshotDTO | null;
  targets: PlannedTargetDTO[];
  versions: PlanVersionDTO[];
  isLocked: boolean;
}

export interface InstrumentSpecDTO {
  canonicalSymbol: string;
  displayName: string;
  assetClass: string;
  preferredUnit: string;
  decimalPrecision: number;
}
