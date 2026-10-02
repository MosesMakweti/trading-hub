"use client";

import { AlertTriangle } from "lucide-react";

import { Textarea } from "@/components/ui/textarea";

/**
 * Today V3 — soft daily limits with accountability (Decision 2). Never a
 * block: when taking this trade would exceed a CONFIRMED limit, the trader
 * states why. The reason is stored on the trade (Trade.limitOverrideReason)
 * with the limit facts at that moment; today's limit itself is never raised.
 */
export function LimitOverrideField({
  messages,
  value,
  onChange,
  id,
}: {
  messages: string[];
  value: string;
  onChange: (next: string) => void;
  id: string;
}) {
  if (messages.length === 0) return null;
  return (
    <div className="space-y-2 rounded-lg border border-warning/40 bg-warning/5 p-3">
      <div className="space-y-1">
        {messages.map((m) => (
          <p key={m} className="flex items-start gap-1.5 text-sm text-warning">
            <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
            {m}
          </p>
        ))}
      </div>
      <label htmlFor={id} className="block text-xs font-medium">
        Reason for overriding today&apos;s limit <span className="text-danger">(required)</span>
      </label>
      <Textarea
        id={id}
        rows={2}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="Why is this trade worth breaking the boundary you set this morning?"
      />
    </div>
  );
}
