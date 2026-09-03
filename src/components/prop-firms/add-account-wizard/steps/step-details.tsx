"use client";

import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { FormField } from "@/components/accounts/form-field";
import type { AccountDraft } from "../types";

export function StepDetails({
  draft,
  onChange,
}: {
  draft: AccountDraft;
  onChange: (patch: Partial<AccountDraft>) => void;
}) {
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
      <FormField label="Account nickname" className="col-span-2">
        <Input
          value={draft.displayName}
          onChange={(e) => onChange({ displayName: e.target.value })}
          placeholder="e.g. 100k Challenge #1"
          autoFocus
        />
      </FormField>
      <FormField label="Account size">
        <Input
          type="number"
          step="0.01"
          value={draft.accountSize}
          onChange={(e) => onChange({ accountSize: e.target.value })}
        />
      </FormField>
      <FormField label="Currency">
        <Input
          value={draft.accountCurrency}
          onChange={(e) => onChange({ accountCurrency: e.target.value.toUpperCase() })}
          maxLength={3}
        />
      </FormField>
      <FormField label="Purchase price">
        <Input
          type="number"
          step="0.01"
          value={draft.purchasePrice}
          onChange={(e) => onChange({ purchasePrice: e.target.value })}
        />
      </FormField>
      <FormField label="Discount applied">
        <Input
          type="number"
          step="0.01"
          value={draft.discount}
          onChange={(e) => onChange({ discount: e.target.value })}
        />
      </FormField>
      <FormField label="Reset fees">
        <Input
          type="number"
          step="0.01"
          value={draft.resetFees}
          onChange={(e) => onChange({ resetFees: e.target.value })}
        />
      </FormField>
      <FormField label="Activation fees">
        <Input
          type="number"
          step="0.01"
          value={draft.activationFees}
          onChange={(e) => onChange({ activationFees: e.target.value })}
        />
      </FormField>
      <FormField label="Other costs">
        <Input
          type="number"
          step="0.01"
          value={draft.otherCosts}
          onChange={(e) => onChange({ otherCosts: e.target.value })}
        />
      </FormField>
      <FormField label="Purchase date">
        <Input type="date" value={draft.purchaseDate} onChange={(e) => onChange({ purchaseDate: e.target.value })} />
      </FormField>
      <FormField label="External reference">
        <Input
          value={draft.externalRef}
          onChange={(e) => onChange({ externalRef: e.target.value })}
          placeholder="Order # or account login"
        />
      </FormField>
      <FormField label="Notes" className="col-span-2">
        <Textarea rows={2} value={draft.notes} onChange={(e) => onChange({ notes: e.target.value })} />
      </FormField>
    </div>
  );
}
