import type {
  ModelTypeLike,
  StageTypeLike,
} from "@/domain/prop-firms/stage-templates";
import type {
  MarketCategoryLike,
  RuleKeyLike,
  RuleValueTypeLike,
} from "@/domain/prop-firms/rule-templates";

export type RuleBreachActionLike =
  | "WARNING_ONLY"
  | "SOFT_BREACH"
  | "HARD_BREACH_FAIL"
  | "HARD_BREACH_TERMINATE"
  | "CUSTOM";

export interface DraftRule {
  localId: string;
  ruleKey: RuleKeyLike;
  name: string;
  valueType: RuleValueTypeLike;
  numericValue: string;
  booleanValue: boolean;
  textValue: string;
  measurementBasis: string;
  measurementPeriod: string;
  warningThreshold: string;
  breachThreshold: string;
  breachAction: RuleBreachActionLike | "";
  description: string;
  isEnabled: boolean;
}

export interface DraftStage {
  localId: string;
  name: string;
  type: StageTypeLike;
  rules: DraftRule[];
}

export interface AccountDraft {
  userPropFirmId: string;
  companyName: string;
  marketCategory: MarketCategoryLike;
  modelType: ModelTypeLike;
  modelName: string;
  displayName: string;
  externalRef: string;
  accountSize: string;
  accountCurrency: string;
  purchasePrice: string;
  discount: string;
  resetFees: string;
  activationFees: string;
  otherCosts: string;
  purchaseDate: string;
  platform: string;
  dataFeed: string;
  notes: string;
  stages: DraftStage[];
}

export type WizardStep = "FIRM" | "MODEL" | "DETAILS" | "STAGES" | "RULES" | "REVIEW";

export const WIZARD_STEPS: WizardStep[] = ["FIRM", "MODEL", "DETAILS", "STAGES", "RULES", "REVIEW"];

export const WIZARD_STEP_LABELS: Record<WizardStep, string> = {
  FIRM: "Firm",
  MODEL: "Model",
  DETAILS: "Details",
  STAGES: "Stages",
  RULES: "Rules",
  REVIEW: "Review",
};
