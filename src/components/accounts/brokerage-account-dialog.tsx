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
  brokerageAccountSchema,
  type BrokerageAccountFormValues,
  type BrokerageAccountInput,
} from "@/lib/validation/accounts";
import { createBrokerageAccount, updateBrokerageAccount } from "@/actions/accounts.actions";

const STATUS_LABELS: Record<string, string> = {
  ACTIVE: "Active",
  PASSED: "Passed",
  FAILED: "Failed",
  SUSPENDED: "Suspended",
  CLOSED: "Closed",
};

const emptyDefaults: BrokerageAccountInput = {
  name: "",
  brokerName: "",
  startingBalance: 0,
  totalWithdrawals: 0,
  totalDeposits: 0,
  status: "ACTIVE",
  notes: undefined,
};

export function BrokerageAccountDialog({
  mode,
  accountId,
  defaultValues,
}: {
  mode: "create" | "edit";
  accountId?: string;
  defaultValues?: BrokerageAccountInput;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);

  const {
    register,
    handleSubmit,
    control,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<BrokerageAccountFormValues, unknown, BrokerageAccountInput>({
    resolver: zodResolver(brokerageAccountSchema),
    defaultValues: defaultValues ?? emptyDefaults,
  });

  async function onSubmit(values: BrokerageAccountInput) {
    const result =
      mode === "create"
        ? await createBrokerageAccount(values)
        : await updateBrokerageAccount(accountId!, values);

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
          Add brokerage account
        </DialogTrigger>
      ) : (
        <DialogTrigger render={<Button variant="ghost" size="icon-sm" />}>
          <Pencil />
        </DialogTrigger>
      )}
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>
            {mode === "create" ? "Add brokerage account" : "Edit account"}
          </DialogTitle>
          <DialogDescription>Track a personal live/demo brokerage account.</DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit(onSubmit)} className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <FormField label="Account name" error={errors.name?.message} className="col-span-2">
            <Input {...register("name")} placeholder="e.g. Main Live Account" />
          </FormField>
          <FormField label="Broker" error={errors.brokerName?.message} className="col-span-2">
            <Input {...register("brokerName")} placeholder="e.g. IC Markets" />
          </FormField>
          <FormField label="Starting balance" error={errors.startingBalance?.message}>
            <Input type="number" step="0.01" {...register("startingBalance")} />
          </FormField>
          <FormField label="Total withdrawals" error={errors.totalWithdrawals?.message}>
            <Input type="number" step="0.01" {...register("totalWithdrawals")} />
          </FormField>
          <FormField label="Total deposits" error={errors.totalDeposits?.message}>
            <Input type="number" step="0.01" {...register("totalDeposits")} />
          </FormField>
          <FormField label="Status" error={errors.status?.message} className="col-span-2">
            <Controller
              control={control}
              name="status"
              render={({ field }) => (
                <Select items={STATUS_LABELS} value={field.value} onValueChange={field.onChange}>
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
