"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ArrowLeft, ArrowRight, Check, History } from "lucide-react";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { createPropFirmAccountAction } from "@/actions/prop-firms.actions";
import type { CreatePropFirmAccountValues } from "@/lib/validation/prop-firms";
import type { UserPropFirmDTO } from "@/types/prop-firms";
import { clearDraft, emptyDraft, loadDraft, numOrUndefined, saveDraft, stagesForModel, strOrUndefined } from "./draft";
import { StepDetails } from "./steps/step-details";
import { StepFirm } from "./steps/step-firm";
import { StepModel } from "./steps/step-model";
import { StepReview } from "./steps/step-review";
import { StepRules } from "./steps/step-rules";
import { StepStages } from "./steps/step-stages";
import { WIZARD_STEPS, WIZARD_STEP_LABELS, type AccountDraft, type WizardStep } from "./types";

function seedFor(firms: UserPropFirmDTO[], firmId?: string) {
  const preselected = firmId ? firms.find((f) => f.id === firmId) : undefined;
  return preselected
    ? { userPropFirmId: preselected.id, companyName: preselected.companyName, marketCategory: preselected.marketCategory }
    : undefined;
}

export function AddAccountWizard({
  firms,
  preselectFirmId,
}: {
  firms: UserPropFirmDTO[];
  preselectFirmId?: string;
}) {
  const router = useRouter();
  const [gate, setGate] = useState<"loading" | "resume" | "wizard">("loading");
  const [draft, setDraft] = useState<AccountDraft>(() => emptyDraft(seedFor(firms, preselectFirmId)));
  const [step, setStep] = useState<WizardStep>("FIRM");
  const [pendingResume, setPendingResume] = useState<{ draft: AccountDraft; step: WizardStep } | null>(null);
  const [isSubmitting, startSubmit] = useTransition();

  useEffect(() => {
    // One-time read from localStorage (an external system unreachable during
    // SSR/the first client render) to decide whether to offer a resume —
    // there's no reactive subscription to set up, just a mount-time check.
    const stored = loadDraft();
    if (stored) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setPendingResume({ draft: stored.draft, step: stored.step });
      setGate("resume");
    } else {
      const seed = seedFor(firms, preselectFirmId);
      setDraft(emptyDraft(seed));
      setStep(seed ? "MODEL" : "FIRM");
      setGate("wizard");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (gate !== "wizard") return;
    saveDraft(draft, step);
  }, [draft, step, gate]);

  function resumeDraft() {
    if (!pendingResume) return;
    setDraft(pendingResume.draft);
    setStep(pendingResume.step);
    setGate("wizard");
  }

  function startFresh() {
    clearDraft();
    const seed = seedFor(firms, preselectFirmId);
    setDraft(emptyDraft(seed));
    setStep(seed ? "MODEL" : "FIRM");
    setGate("wizard");
  }

  const stepIndex = WIZARD_STEPS.indexOf(step);

  function patchDraft(patch: Partial<AccountDraft>) {
    setDraft((d) => ({ ...d, ...patch }));
  }

  function canGoNext(): boolean {
    switch (step) {
      case "FIRM":
        return Boolean(draft.userPropFirmId);
      case "DETAILS": {
        const size = numOrUndefined(draft.accountSize);
        return Boolean(draft.displayName.trim()) && size != null && size > 0;
      }
      case "STAGES":
        return draft.stages.length > 0 && draft.stages.every((s) => s.name.trim().length > 0);
      default:
        return true;
    }
  }

  function goNext() {
    if (!canGoNext()) return;
    const next = WIZARD_STEPS[stepIndex + 1];
    if (next) setStep(next);
  }

  function goBack() {
    const prev = WIZARD_STEPS[stepIndex - 1];
    if (prev) setStep(prev);
  }

  function handleSelectFirm(firm: UserPropFirmDTO) {
    patchDraft({ userPropFirmId: firm.id, companyName: firm.companyName, marketCategory: firm.marketCategory });
    setStep("MODEL");
  }

  function handleModelTypeChange(modelType: AccountDraft["modelType"]) {
    if (modelType === draft.modelType) return;
    setDraft((d) => ({ ...d, modelType, stages: stagesForModel(modelType) }));
  }

  function handleCreate() {
    startSubmit(async () => {
      const payload: CreatePropFirmAccountValues = {
        userPropFirmId: draft.userPropFirmId,
        displayName: draft.displayName.trim(),
        externalRef: strOrUndefined(draft.externalRef),
        marketCategory: draft.marketCategory,
        modelName: strOrUndefined(draft.modelName),
        modelType: draft.modelType,
        accountSize: numOrUndefined(draft.accountSize) ?? 0,
        accountCurrency: draft.accountCurrency || "USD",
        purchasePrice: numOrUndefined(draft.purchasePrice),
        discount: numOrUndefined(draft.discount),
        resetFees: numOrUndefined(draft.resetFees),
        activationFees: numOrUndefined(draft.activationFees),
        otherCosts: numOrUndefined(draft.otherCosts),
        purchaseDate: draft.purchaseDate ? new Date(draft.purchaseDate) : undefined,
        notes: strOrUndefined(draft.notes),
        stages: draft.stages.map((s) => ({
          name: s.name.trim(),
          type: s.type,
          rules: s.rules.map((r) => ({
            name: r.name.trim(),
            ruleKey: r.ruleKey,
            valueType: r.valueType,
            numericValue: numOrUndefined(r.numericValue),
            booleanValue: r.valueType === "BOOLEAN" ? r.booleanValue : undefined,
            textValue: strOrUndefined(r.textValue),
            measurementBasis: strOrUndefined(r.measurementBasis),
            measurementPeriod: strOrUndefined(r.measurementPeriod),
            warningThreshold: numOrUndefined(r.warningThreshold),
            breachThreshold: numOrUndefined(r.breachThreshold),
            breachAction: r.breachAction || undefined,
            description: strOrUndefined(r.description),
            isEnabled: r.isEnabled,
          })),
        })),
      };

      const result = await createPropFirmAccountAction(payload);
      if (!result.success) {
        toast.error(result.error);
        return;
      }
      toast.success("Account created.");
      clearDraft();
      router.push(`/prop-firms?market=${draft.marketCategory}`);
      router.refresh();
    });
  }

  if (gate === "loading") return null;

  if (gate === "resume" && pendingResume) {
    return (
      <div className="glass mx-auto max-w-md space-y-4 rounded-2xl p-6 text-center">
        <History className="mx-auto size-8 text-muted-foreground" />
        <div>
          <h2 className="text-base font-medium">Resume your draft?</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            You have an unfinished account
            {pendingResume.draft.companyName ? ` for ${pendingResume.draft.companyName}` : ""}
            {pendingResume.draft.displayName ? ` — "${pendingResume.draft.displayName}"` : ""}.
          </p>
        </div>
        <div className="flex justify-center gap-2">
          <Button type="button" variant="outline" onClick={startFresh}>
            Start over
          </Button>
          <Button type="button" onClick={resumeDraft}>
            Resume
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="glass mx-auto max-w-2xl space-y-4 rounded-2xl p-6">
      <div>
        <h1 className="text-lg font-medium">Add a purchased account</h1>
        <p className="text-sm text-muted-foreground">
          Step {stepIndex + 1} of {WIZARD_STEPS.length} · {WIZARD_STEP_LABELS[step]}
        </p>
      </div>

      <div className="flex gap-1" aria-hidden>
        {WIZARD_STEPS.map((s, i) => (
          <div key={s} className={cn("h-1 flex-1 rounded-full", i <= stepIndex ? "bg-primary" : "bg-muted")} />
        ))}
      </div>

      <div className="min-h-72">
        {step === "FIRM" && <StepFirm firms={firms} draft={draft} onSelect={handleSelectFirm} />}
        {step === "MODEL" && (
          <StepModel
            draft={draft}
            onModelTypeChange={handleModelTypeChange}
            onModelNameChange={(modelName) => patchDraft({ modelName })}
          />
        )}
        {step === "DETAILS" && <StepDetails draft={draft} onChange={patchDraft} />}
        {step === "STAGES" && (
          <StepStages stages={draft.stages} onChange={(stages) => patchDraft({ stages })} />
        )}
        {step === "RULES" && (
          <StepRules
            stages={draft.stages}
            marketCategory={draft.marketCategory}
            onChange={(stages) => patchDraft({ stages })}
          />
        )}
        {step === "REVIEW" && <StepReview draft={draft} />}
      </div>

      <div className="flex items-center justify-between border-t border-border pt-4">
        <Button type="button" variant="ghost" onClick={goBack} disabled={stepIndex === 0} className="gap-1.5">
          <ArrowLeft className="size-3.5" />
          Back
        </Button>
        {step === "REVIEW" ? (
          <Button type="button" onClick={handleCreate} disabled={isSubmitting} className="gap-1.5">
            <Check className="size-3.5" />
            {isSubmitting ? "Creating…" : "Create account"}
          </Button>
        ) : (
          <Button type="button" onClick={goNext} disabled={!canGoNext()} className="gap-1.5">
            Next
            <ArrowRight className="size-3.5" />
          </Button>
        )}
      </div>
    </div>
  );
}
