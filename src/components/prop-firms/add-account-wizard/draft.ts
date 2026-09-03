import { defaultStagesForModel, type ModelTypeLike } from "@/domain/prop-firms/stage-templates";
import type { AccountDraft, DraftRule, DraftStage, WizardStep } from "./types";

const STORAGE_KEY = "traditorium:prop-firms:add-account-draft";

function uid(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : Math.random().toString(36).slice(2);
}

export function stagesForModel(modelType: ModelTypeLike): DraftStage[] {
  return defaultStagesForModel(modelType).map((t) => ({
    localId: uid(),
    name: t.name,
    type: t.type,
    rules: [],
  }));
}

export function newDraftRule(overrides: Partial<DraftRule> & Pick<DraftRule, "ruleKey" | "name" | "valueType">): DraftRule {
  return {
    localId: uid(),
    numericValue: "",
    booleanValue: false,
    textValue: "",
    measurementBasis: "",
    measurementPeriod: "",
    warningThreshold: "",
    breachThreshold: "",
    breachAction: "",
    description: "",
    isEnabled: true,
    ...overrides,
  };
}

export function emptyDraft(seed?: { userPropFirmId?: string; companyName?: string; marketCategory?: "CFD" | "FUTURES" }): AccountDraft {
  const modelType: ModelTypeLike = "TWO_PHASE";
  return {
    userPropFirmId: seed?.userPropFirmId ?? "",
    companyName: seed?.companyName ?? "",
    marketCategory: seed?.marketCategory ?? "CFD",
    modelType,
    modelName: "",
    displayName: "",
    externalRef: "",
    accountSize: "100000",
    accountCurrency: "USD",
    purchasePrice: "",
    discount: "",
    resetFees: "",
    activationFees: "",
    otherCosts: "",
    purchaseDate: "",
    notes: "",
    stages: stagesForModel(modelType),
  };
}

interface StoredWizardState {
  draft: AccountDraft;
  step: WizardStep;
  savedAt: string;
}

export function loadDraft(): StoredWizardState | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as StoredWizardState;
    if (!parsed?.draft) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function saveDraft(draft: AccountDraft, step: WizardStep): void {
  if (typeof window === "undefined") return;
  const payload: StoredWizardState = { draft, step, savedAt: new Date().toISOString() };
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
}

export function clearDraft(): void {
  if (typeof window === "undefined") return;
  window.localStorage.removeItem(STORAGE_KEY);
}

/** Empty-string → undefined so optional numeric Zod fields aren't coerced to 0. */
export function numOrUndefined(value: string): number | undefined {
  const trimmed = value.trim();
  return trimmed === "" ? undefined : Number(trimmed);
}

export function strOrUndefined(value: string): string | undefined {
  const trimmed = value.trim();
  return trimmed === "" ? undefined : trimmed;
}
