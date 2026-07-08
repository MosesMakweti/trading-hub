"use client";

import { useState } from "react";
import { Controller, useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Pencil, Plus } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
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
import {
  propFirmAccountSchema,
  type PropFirmAccountFormValues,
  type PropFirmAccountInput,
} from "@/lib/validation/accounts";
import { createPropFirmAccount, updatePropFirmAccount } from "@/actions/accounts.actions";

const PHASE_LABELS: Record<string, string> = {
  PHASE_1: "Phase 1",
  PHASE_2: "Phase 2",
  MASTER: "Master Account",
};

const STATUS_LABELS: Record<string, string> = {
  ACTIVE: "Active",
  PASSED: "Passed",
  FAILED: "Failed",
  SUSPENDED: "Suspended",
  CLOSED: "Closed",
};

const emptyDefaults: PropFirmAccountInput = {
  name: "",
  propFirmName: "",
  accountSize: 0,
  currentBalance: 0,
  phase: "PHASE_1",
  purchaseCost: 0,
  totalPayouts: 0,
  status: "ACTIVE",
  notes: undefined,
};

export function PropFirmAccountDialog({
  mode,
  accountId,
  defaultValues,
}: {
  mode: "create" | "edit";
  accountId?: string;
  defaultValues?: PropFirmAccountInput;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);

  const {
    register,
    handleSubmit,
    control,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<PropFirmAccountFormValues, unknown, PropFirmAccountInput>({
    resolver: zodResolver(propFirmAccountSchema),
    defaultValues: defaultValues ?? emptyDefaults,
  });

  async function onSubmit(values: PropFirmAccountInput) {
    const result =
      mode === "create"
        ? await createPropFirmAccount(values)
        : await updatePropFirmAccount(accountId!, values);

    if (!result.success) {
      toast.error(result.error ?? "Something went wrong.");
      return;
    }
    setOpen(false);
    if (mode === "create") reset(emptyDefaults);
    router.refresh();
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next && defaultValues) reset(defaultValues);
      }}
    >
      {mode === "create" ? (
        <DialogTrigger render={<Button size="sm" className="gap-1.5" />}>
          <Plus className="size-3.5" />
          Add prop firm account
        </DialogTrigger>
      ) : (
        <DialogTrigger render={<Button variant="ghost" size="icon-sm" />}>
          <Pencil />
        </DialogTrigger>
      )}
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{mode === "create" ? "Add prop firm account" : "Edit account"}</DialogTitle>
          <DialogDescription>Track a funded/challenge account and its payouts.</DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit(onSubmit)} className="grid grid-cols-2 gap-3">
          <FormField label="Account name" error={errors.name?.message} className="col-span-2">
            <Input {...register("name")} placeholder="e.g. FTMO 100k #1" />
          </FormField>
          <FormField
            label="Prop firm"
            error={errors.propFirmName?.message}
            className="col-span-2"
          >
            <Input {...register("propFirmName")} placeholder="e.g. FTMO" />
          </FormField>
          <FormField label="Account size" error={errors.accountSize?.message}>
            <Input type="number" step="0.01" {...register("accountSize")} />
          </FormField>
          <FormField label="Current balance" error={errors.currentBalance?.message}>
            <Input type="number" step="0.01" {...register("currentBalance")} />
          </FormField>
          <FormField label="Purchase cost" error={errors.purchaseCost?.message}>
            <Input type="number" step="0.01" {...register("purchaseCost")} />
          </FormField>
          <FormField label="Total payouts" error={errors.totalPayouts?.message}>
            <Input type="number" step="0.01" {...register("totalPayouts")} />
          </FormField>
          <FormField label="Phase" error={errors.phase?.message}>
            <Controller
              control={control}
              name="phase"
              render={({ field }) => (
                <Select value={field.value} onValueChange={field.onChange}>
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {Object.entries(PHASE_LABELS).map(([value, label]) => (
                      <SelectItem key={value} value={value}>
                        {label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            />
          </FormField>
          <FormField label="Status" error={errors.status?.message}>
            <Controller
              control={control}
              name="status"
              render={({ field }) => (
                <Select value={field.value} onValueChange={field.onChange}>
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {Object.entries(STATUS_LABELS).map(([value, label]) => (
                      <SelectItem key={value} value={value}>
                        {label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            />
          </FormField>
          <FormField label="Notes" className="col-span-2">
            <Textarea rows={3} {...register("notes")} />
          </FormField>
          <DialogFooter className="col-span-2">
            <Button type="submit" disabled={isSubmitting}>
              {isSubmitting ? "Saving..." : "Save account"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
