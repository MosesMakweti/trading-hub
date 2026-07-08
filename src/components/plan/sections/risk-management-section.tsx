"use client";

import { useState } from "react";
import { toast } from "sonner";

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RichTextEditor } from "@/components/plan/rich-text-editor";
import { updateRiskManagement } from "@/actions/trading-plan.actions";

interface Plan {
  maxDailyRiskPercent: unknown;
  maxWeeklyRiskPercent: unknown;
  maxOpenPositions: number | null;
  maxRiskPerTradePercent: unknown;
  riskManagementRules: unknown;
}

interface Values {
  maxDailyRiskPercent: string;
  maxWeeklyRiskPercent: string;
  maxOpenPositions: string;
  maxRiskPerTradePercent: string;
}

export function RiskManagementSection({ plan }: { plan: Plan }) {
  const [values, setValues] = useState<Values>({
    maxDailyRiskPercent: plan.maxDailyRiskPercent?.toString() ?? "",
    maxWeeklyRiskPercent: plan.maxWeeklyRiskPercent?.toString() ?? "",
    maxOpenPositions: plan.maxOpenPositions?.toString() ?? "",
    maxRiskPerTradePercent: plan.maxRiskPerTradePercent?.toString() ?? "",
  });

  async function persist(next: Values, rules?: object) {
    const result = await updateRiskManagement({
      maxDailyRiskPercent: next.maxDailyRiskPercent ? Number(next.maxDailyRiskPercent) : null,
      maxWeeklyRiskPercent: next.maxWeeklyRiskPercent ? Number(next.maxWeeklyRiskPercent) : null,
      maxOpenPositions: next.maxOpenPositions ? Number(next.maxOpenPositions) : null,
      maxRiskPerTradePercent: next.maxRiskPerTradePercent
        ? Number(next.maxRiskPerTradePercent)
        : null,
      riskManagementRules: rules ?? plan.riskManagementRules ?? null,
    });
    if (!result.success) toast.error(result.error ?? "Failed to save.");
    return result;
  }

  function updateField(key: keyof Values, value: string) {
    setValues((prev) => ({ ...prev, [key]: value }));
  }

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Field
          label="Max daily risk %"
          value={values.maxDailyRiskPercent}
          onChange={(v) => updateField("maxDailyRiskPercent", v)}
          onBlurSave={() => persist(values)}
        />
        <Field
          label="Max weekly risk %"
          value={values.maxWeeklyRiskPercent}
          onChange={(v) => updateField("maxWeeklyRiskPercent", v)}
          onBlurSave={() => persist(values)}
        />
        <Field
          label="Max open positions"
          value={values.maxOpenPositions}
          onChange={(v) => updateField("maxOpenPositions", v)}
          onBlurSave={() => persist(values)}
        />
        <Field
          label="Max risk per trade %"
          value={values.maxRiskPerTradePercent}
          onChange={(v) => updateField("maxRiskPerTradePercent", v)}
          onBlurSave={() => persist(values)}
        />
      </div>
      <div>
        <Label className="mb-1.5 block text-xs">Rules &amp; approach</Label>
        <RichTextEditor
          initialContent={plan.riskManagementRules}
          placeholder="Describe your risk rules and approach..."
          onSave={(content) => persist(values, content)}
        />
      </div>
    </div>
  );
}

function Field({
  label,
  value,
  onChange,
  onBlurSave,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  onBlurSave: () => void;
}) {
  return (
    <div className="space-y-1">
      <Label className="text-xs">{label}</Label>
      <Input
        type="number"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onBlur={onBlurSave}
        className="h-8"
      />
    </div>
  );
}
