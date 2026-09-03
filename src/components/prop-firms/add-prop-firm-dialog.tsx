"use client";

import { useMemo, useState } from "react";
import { Controller, useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ArrowLeft, ArrowRight, Check, Plus, Search } from "lucide-react";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { FormField } from "@/components/accounts/form-field";
import { PropFirmLogo } from "@/components/prop-firms/prop-firm-logo";
import {
  createUserPropFirmSchema,
  type CreateUserPropFirmFormValues,
  type CreateUserPropFirmValues,
} from "@/lib/validation/prop-firms";
import { createUserPropFirmAction } from "@/actions/prop-firms.actions";
import type { DirectoryEntryDTO } from "@/types/prop-firms";

const MARKET_LABELS: Record<string, string> = { CFD: "CFD", FUTURES: "Futures" };

type Step = "CATEGORY" | "SELECT" | "CUSTOM" | "CONFIRM" | "PRIORITY";
const ALL_STEPS: Step[] = ["CATEGORY", "SELECT", "CUSTOM", "CONFIRM", "PRIORITY"];
const STEP_LABELS: Record<Step, string> = {
  CATEGORY: "Category",
  SELECT: "Company",
  CUSTOM: "Custom firm",
  CONFIRM: "Confirm",
  PRIORITY: "Priority",
};

function defaultsFor(market: "CFD" | "FUTURES"): CreateUserPropFirmFormValues {
  return {
    identityKind: "DIRECTORY",
    directoryEntryId: undefined,
    customCompanyName: "",
    customLogoUrl: "",
    customWebsite: "",
    customAccentColor: "",
    marketCategory: market,
    isPriority: false,
    priorityOrder: undefined,
    notes: undefined,
  };
}

export function AddPropFirmDialog({
  directory,
  defaultMarket = "CFD",
}: {
  directory: DirectoryEntryDTO[];
  defaultMarket?: "CFD" | "FUTURES";
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState<Step>("CATEGORY");
  const [search, setSearch] = useState("");

  const {
    register,
    handleSubmit,
    control,
    reset,
    trigger,
    setValue,
    formState: { errors, isSubmitting },
  } = useForm<CreateUserPropFirmFormValues, unknown, CreateUserPropFirmValues>({
    resolver: zodResolver(createUserPropFirmSchema),
    defaultValues: defaultsFor(defaultMarket),
  });

  const identityKind = useWatch({ control, name: "identityKind" });
  const marketCategory = useWatch({ control, name: "marketCategory" });
  const selectedDirectoryId = useWatch({ control, name: "directoryEntryId" });
  const customCompanyName = useWatch({ control, name: "customCompanyName" });
  const selectedEntry = directory.find((d) => d.id === selectedDirectoryId);

  // CUSTOM only appears as a numbered step once that branch is actually
  // taken — a directory pick never sees a "step 3 of 5" that doesn't apply.
  const visibleSteps = identityKind === "CUSTOM" ? ALL_STEPS : ALL_STEPS.filter((s) => s !== "CUSTOM");
  const stepIndex = visibleSteps.indexOf(step);

  const results = useMemo(() => {
    const q = search.trim().toLowerCase();
    return directory
      .filter((d) => d.markets.includes(marketCategory))
      .filter((d) => !q || d.companyName.toLowerCase().includes(q));
  }, [directory, marketCategory, search]);

  function resetAll() {
    reset(defaultsFor(defaultMarket));
    setStep("CATEGORY");
    setSearch("");
  }

  async function onSubmit(values: CreateUserPropFirmValues) {
    const result = await createUserPropFirmAction(values);
    if (!result.success) {
      toast.error(result.error);
      return;
    }
    toast.success("Prop firm added.");
    setOpen(false);
    resetAll();
    router.refresh();
  }

  function goNext() {
    if (step === "SELECT" && !selectedEntry) return;
    if (step === "CUSTOM" && !customCompanyName?.trim()) {
      void trigger("customCompanyName");
      return;
    }
    const next = visibleSteps[stepIndex + 1];
    if (next) setStep(next);
  }

  function goBack() {
    const prev = visibleSteps[stepIndex - 1];
    if (prev) setStep(prev);
  }

  function selectDirectoryEntry(entry: DirectoryEntryDTO) {
    setValue("identityKind", "DIRECTORY");
    setValue("directoryEntryId", entry.id);
    setStep("CONFIRM");
  }

  function goCustom() {
    setValue("identityKind", "CUSTOM");
    setValue("directoryEntryId", undefined);
    setStep("CUSTOM");
  }

  const isLastStep = step === "PRIORITY";

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) resetAll();
      }}
    >
      <DialogTrigger render={<Button size="sm" className="gap-1.5" />}>
        <Plus className="size-3.5" />
        Add prop firm
      </DialogTrigger>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Add a prop firm</DialogTitle>
          <DialogDescription>
            Step {stepIndex + 1} of {visibleSteps.length} · {STEP_LABELS[step]}
          </DialogDescription>
        </DialogHeader>

        <div className="flex gap-1" aria-hidden>
          {visibleSteps.map((s, i) => (
            <div key={s} className={cn("h-1 flex-1 rounded-full", i <= stepIndex ? "bg-primary" : "bg-muted")} />
          ))}
        </div>

        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
          {step === "CATEGORY" && (
            <div className="grid grid-cols-2 gap-3">
              {(["CFD", "FUTURES"] as const).map((m) => (
                <button
                  key={m}
                  type="button"
                  onClick={() => {
                    setValue("marketCategory", m);
                    setStep("SELECT");
                  }}
                  className={cn(
                    "rounded-xl border border-border p-6 text-center transition-colors hover:border-primary hover:bg-muted",
                    marketCategory === m && "border-primary bg-muted",
                  )}
                >
                  <span className="text-base font-medium">{MARKET_LABELS[m]}</span>
                </button>
              ))}
            </div>
          )}

          {step === "SELECT" && (
            <div className="space-y-3">
              <div className="relative">
                <Search className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" />
                <Input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder={`Search ${MARKET_LABELS[marketCategory]} prop firms…`}
                  className="pl-8"
                  autoFocus
                />
              </div>
              <div className="max-h-64 space-y-1 overflow-y-auto">
                {results.length === 0 ? (
                  <p className="py-6 text-center text-sm text-muted-foreground">No matches.</p>
                ) : (
                  results.map((entry) => (
                    <button
                      key={entry.id}
                      type="button"
                      onClick={() => selectDirectoryEntry(entry)}
                      className={cn(
                        "flex w-full items-center gap-2.5 rounded-lg border border-border px-3 py-2 text-left transition-colors hover:border-primary hover:bg-muted",
                        selectedDirectoryId === entry.id && "border-primary bg-muted",
                      )}
                    >
                      <PropFirmLogo
                        name={entry.companyName}
                        logoUrl={entry.logoUrl}
                        accentColor={entry.accentColor}
                        className="size-7"
                      />
                      <span className="min-w-0 flex-1 truncate text-sm font-medium">{entry.companyName}</span>
                      <span className="text-xs text-muted-foreground">
                        {entry.markets.map((m) => MARKET_LABELS[m]).join(" / ")}
                      </span>
                    </button>
                  ))
                )}
              </div>
              <button type="button" onClick={goCustom} className="text-xs text-primary hover:underline">
                Can&apos;t find your firm? Add a custom one.
              </button>
              {errors.directoryEntryId && <p className="text-xs text-danger">{errors.directoryEntryId.message}</p>}
            </div>
          )}

          {step === "CUSTOM" && (
            <div className="space-y-3">
              <FormField label="Company name" error={errors.customCompanyName?.message}>
                <Input {...register("customCompanyName")} placeholder="e.g. My Local Prop Firm" autoFocus />
              </FormField>
              <div className="grid grid-cols-2 gap-3">
                <FormField label="Website" error={errors.customWebsite?.message}>
                  <Input {...register("customWebsite")} placeholder="https://…" />
                </FormField>
                <FormField label="Accent color" error={errors.customAccentColor?.message}>
                  <Input {...register("customAccentColor")} placeholder="#4f46e5" />
                </FormField>
              </div>
            </div>
          )}

          {step === "CONFIRM" && (
            <div className="space-y-3">
              <div className="flex items-center gap-3 rounded-xl border border-border p-4">
                <PropFirmLogo
                  name={identityKind === "DIRECTORY" ? (selectedEntry?.companyName ?? "") : customCompanyName || "?"}
                  logoUrl={identityKind === "DIRECTORY" ? selectedEntry?.logoUrl : undefined}
                  className="size-11"
                />
                <div>
                  <div className="font-medium">
                    {identityKind === "DIRECTORY" ? selectedEntry?.companyName : customCompanyName || "Untitled firm"}
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {MARKET_LABELS[marketCategory]} · {identityKind === "DIRECTORY" ? "From directory" : "Custom"}
                  </div>
                </div>
              </div>
              <p className="text-xs text-muted-foreground">
                Review the details above, or go back to change the company or category.
              </p>
            </div>
          )}

          {step === "PRIORITY" && (
            <div className="space-y-3">
              <div className="flex items-center justify-between rounded-lg border border-border px-3 py-2.5">
                <div className="space-y-0.5">
                  <Label htmlFor="isPriority" className="text-sm">
                    Mark as a priority firm
                  </Label>
                  <p className="text-xs text-muted-foreground">Priority isn&apos;t exclusive — you can prioritize more than one.</p>
                </div>
                <Controller
                  control={control}
                  name="isPriority"
                  render={({ field }) => (
                    <Switch id="isPriority" checked={field.value ?? false} onCheckedChange={field.onChange} />
                  )}
                />
              </div>
              <FormField label="Notes" error={errors.notes?.message}>
                <Textarea rows={2} {...register("notes")} placeholder="Optional" />
              </FormField>
            </div>
          )}

          <DialogFooter className="flex items-center justify-between sm:justify-between">
            <Button type="button" variant="ghost" onClick={goBack} disabled={stepIndex === 0} className="gap-1.5">
              <ArrowLeft className="size-3.5" />
              Back
            </Button>
            {isLastStep ? (
              <Button type="button" onClick={handleSubmit(onSubmit)} disabled={isSubmitting} className="gap-1.5">
                <Check className="size-3.5" />
                {isSubmitting ? "Adding…" : "Add prop firm"}
              </Button>
            ) : (
              <Button
                type="button"
                onClick={goNext}
                disabled={step === "SELECT" && !selectedEntry}
                className="gap-1.5"
              >
                Next
                <ArrowRight className="size-3.5" />
              </Button>
            )}
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
