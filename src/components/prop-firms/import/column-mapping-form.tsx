"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Save } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { FormField } from "@/components/accounts/form-field";
import { savePropFirmImportMappingTemplateAction } from "@/actions/prop-firm-import.actions";
import type { ColumnMapping } from "@/domain/prop-firms/import/types";
import type { MappingTemplateDTO } from "@/types/prop-firms";

const NONE = "__none__";

const REQUIRED_FIELDS: { key: string; label: string }[] = [
  { key: "instrument", label: "Instrument / symbol" },
  { key: "direction", label: "Direction (buy / sell)" },
  { key: "quantity", label: "Quantity / volume" },
  { key: "price", label: "Fill price" },
  { key: "executedAt", label: "Execution time" },
];

const TRADE_DETAIL_FIELDS: { key: string; label: string }[] = [
  { key: "grossPnl", label: "Gross P&L" },
  { key: "commission", label: "Commission" },
  { key: "swap", label: "Swap" },
  { key: "otherFees", label: "Other fees" },
  { key: "currency", label: "Currency" },
  { key: "platformExecutionId", label: "Execution / ticket ID" },
  { key: "platformOrderId", label: "Order ID" },
  { key: "platformDealId", label: "Deal ID" },
];

const CASH_FIELDS: { key: string; label: string }[] = [
  { key: "transactionType", label: "Transaction type" },
  { key: "amount", label: "Amount" },
  { key: "occurredAt", label: "Transaction time" },
  { key: "platformTransactionId", label: "Transaction ID" },
];

export const REQUIRED_MAPPING_KEYS = REQUIRED_FIELDS.map((f) => f.key);

function MappingRow({
  label,
  field,
  headers,
  mapping,
  onChange,
}: {
  label: string;
  field: string;
  headers: string[];
  mapping: ColumnMapping;
  onChange: (next: ColumnMapping) => void;
}) {
  const current = mapping[field] ?? NONE;
  return (
    <FormField label={label}>
      <Select
        value={current}
        onValueChange={(v) => onChange({ ...mapping, [field]: v && v !== NONE ? v : undefined })}
      >
        <SelectTrigger className="w-full" aria-label={label}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent className="max-h-64">
          <SelectItem value={NONE}>— not mapped —</SelectItem>
          {headers.map((h) => (
            <SelectItem key={h} value={h}>
              {h}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </FormField>
  );
}

export function ColumnMappingForm({
  headers,
  mapping,
  onChange,
  templates,
}: {
  headers: string[];
  mapping: ColumnMapping;
  onChange: (next: ColumnMapping) => void;
  templates: MappingTemplateDTO[];
}) {
  const router = useRouter();
  const [templateName, setTemplateName] = useState("");
  const [isSaving, startSave] = useTransition();

  const genericTemplates = templates.filter((t) => t.platform === "GENERIC_CSV");

  function loadTemplate(id: string) {
    const tpl = genericTemplates.find((t) => t.id === id);
    if (tpl) onChange({ ...tpl.columnMapping });
  }

  function saveTemplate() {
    const name = templateName.trim();
    if (!name) return;
    startSave(async () => {
      const result = await savePropFirmImportMappingTemplateAction({ name, platform: "GENERIC_CSV", mapping });
      if (!result.success) {
        toast.error(result.error);
        return;
      }
      toast.success("Column mapping saved.");
      setTemplateName("");
      router.refresh();
    });
  }

  return (
    <div className="space-y-4">
      {genericTemplates.length > 0 && (
        <FormField label="Load a saved mapping">
          <Select value={NONE} onValueChange={(v) => v && v !== NONE && loadTemplate(v)}>
            <SelectTrigger className="w-full" aria-label="Load a saved mapping">
              <SelectValue placeholder="Choose a template…" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={NONE}>Choose a template…</SelectItem>
              {genericTemplates.map((t) => (
                <SelectItem key={t.id} value={t.id}>
                  {t.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </FormField>
      )}

      <div>
        <p className="mb-2 text-xs font-medium text-muted-foreground">Required — trade executions</p>
        <div className="grid gap-3 sm:grid-cols-2">
          {REQUIRED_FIELDS.map((f) => (
            <MappingRow key={f.key} label={f.label} field={f.key} headers={headers} mapping={mapping} onChange={onChange} />
          ))}
        </div>
      </div>

      <div>
        <p className="mb-2 text-xs font-medium text-muted-foreground">Optional — trade details</p>
        <div className="grid gap-3 sm:grid-cols-2">
          {TRADE_DETAIL_FIELDS.map((f) => (
            <MappingRow key={f.key} label={f.label} field={f.key} headers={headers} mapping={mapping} onChange={onChange} />
          ))}
        </div>
      </div>

      <div>
        <p className="mb-2 text-xs font-medium text-muted-foreground">Optional — deposits / withdrawals</p>
        <div className="grid gap-3 sm:grid-cols-2">
          {CASH_FIELDS.map((f) => (
            <MappingRow key={f.key} label={f.label} field={f.key} headers={headers} mapping={mapping} onChange={onChange} />
          ))}
        </div>
      </div>

      <div className="flex items-end gap-2 border-t border-border pt-3">
        <FormField label="Save this mapping as a template" className="flex-1">
          <Input
            value={templateName}
            onChange={(e) => setTemplateName(e.target.value)}
            placeholder="e.g. My broker export"
          />
        </FormField>
        <Button
          type="button"
          variant="outline"
          className="gap-1.5"
          disabled={isSaving || !templateName.trim()}
          onClick={saveTemplate}
        >
          <Save className="size-3.5" />
          Save
        </Button>
      </div>
    </div>
  );
}
