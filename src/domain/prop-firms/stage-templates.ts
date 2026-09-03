/**
 * Model type -> a starting set of stages (name + type only — never numeric
 * rules, which the trader must enter/confirm themselves; see the Add Account
 * wizard). Purely a convenience default; every generated stage is editable
 * and reorderable before the account is created.
 */
export type ModelTypeLike = "ONE_PHASE" | "TWO_PHASE" | "THREE_PHASE" | "INSTANT_FUNDED" | "CUSTOM";
export type StageTypeLike =
  | "PHASE_1"
  | "PHASE_2"
  | "PHASE_3"
  | "VERIFICATION"
  | "MASTER_FUNDED"
  | "PAYOUT_ELIGIBLE"
  | "CUSTOM";

export interface StageTemplate {
  name: string;
  type: StageTypeLike;
}

export function defaultStagesForModel(modelType: ModelTypeLike): StageTemplate[] {
  switch (modelType) {
    case "ONE_PHASE":
      return [
        { name: "Phase 1", type: "PHASE_1" },
        { name: "Master / Funded", type: "MASTER_FUNDED" },
      ];
    case "TWO_PHASE":
      return [
        { name: "Phase 1", type: "PHASE_1" },
        { name: "Phase 2", type: "PHASE_2" },
        { name: "Master / Funded", type: "MASTER_FUNDED" },
      ];
    case "THREE_PHASE":
      return [
        { name: "Phase 1", type: "PHASE_1" },
        { name: "Phase 2", type: "PHASE_2" },
        { name: "Phase 3", type: "PHASE_3" },
        { name: "Master / Funded", type: "MASTER_FUNDED" },
      ];
    case "INSTANT_FUNDED":
      return [{ name: "Master / Funded", type: "MASTER_FUNDED" }];
    case "CUSTOM":
      return [{ name: "Stage 1", type: "CUSTOM" }];
    default: {
      const _never: never = modelType;
      return _never;
    }
  }
}
