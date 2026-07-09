"use client";

import { Controller, type Control } from "react-hook-form";
import { X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { TradeFormValues } from "@/lib/validation/trades";

export function TradeAccountRow({
  control,
  index,
  accountName,
  onRemove,
}: {
  control: Control<TradeFormValues>;
  index: number;
  accountName: string;
  onRemove: () => void;
}) {
  return (
    <div className="flex items-center gap-2 rounded-lg border border-border bg-background/40 p-3">
      <div className="grid flex-1 grid-cols-2 items-end gap-3 sm:grid-cols-3">
        <div>
          <span className="text-xs font-medium">{accountName}</span>
          <p className="text-[11px] text-muted-foreground">PnL auto-calculated from Performance Account</p>
        </div>
        <div className="space-y-1">
          <label className="text-xs text-muted-foreground">Risk type</label>
          <Controller
            control={control}
            name={`allocations.${index}.riskInputType`}
            render={({ field }) => (
              <Select
                items={{ PERCENT: "% Risk", AMOUNT: "$ Amount" }}
                value={field.value}
                onValueChange={field.onChange}
              >
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="PERCENT">% Risk</SelectItem>
                  <SelectItem value="AMOUNT">$ Amount</SelectItem>
                </SelectContent>
              </Select>
            )}
          />
        </div>
        <div className="space-y-1">
          <label className="text-xs text-muted-foreground">Risk value</label>
          <Controller
            control={control}
            name={`allocations.${index}.riskValue`}
            render={({ field }) => (
              <Input
                type="number"
                step="0.01"
                name={field.name}
                value={field.value as number}
                onChange={(e) => field.onChange(e.target.valueAsNumber)}
              />
            )}
          />
        </div>
      </div>
      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        aria-label="Remove account from trade"
        onClick={onRemove}
      >
        <X />
      </Button>
    </div>
  );
}
