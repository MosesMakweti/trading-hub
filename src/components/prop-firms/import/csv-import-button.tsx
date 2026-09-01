"use client";

import { useState } from "react";
import { UploadCloud } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import type { MappingTemplateDTO } from "@/types/prop-firms";
import { ImportWizard } from "./import-wizard";

export function CsvImportButton({
  accountId,
  accountName,
  mappingTemplates,
  size = "sm",
  variant = "outline",
}: {
  accountId: string;
  accountName: string;
  mappingTemplates: MappingTemplateDTO[];
  size?: "sm" | "default";
  variant?: "outline" | "secondary" | "ghost";
}) {
  const [open, setOpen] = useState(false);
  // Remount the wizard on every open so it always starts on step 1 with fresh state.
  const [instance, setInstance] = useState(0);

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next) setInstance((n) => n + 1);
      }}
    >
      <DialogTrigger render={<Button size={size} variant={variant} className="gap-1.5" />}>
        <UploadCloud className="size-3.5" />
        Import statement
      </DialogTrigger>
      <DialogContent className="max-h-[88vh] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Import a statement — {accountName}</DialogTitle>
          <DialogDescription>
            Upload a CSV, Excel, HTML or XML statement from MT4, MT5, cTrader, NinjaTrader, Tradovate or any broker to
            populate this account&apos;s trades, balance, and payouts.
          </DialogDescription>
        </DialogHeader>
        <ImportWizard
          key={instance}
          accountId={accountId}
          mappingTemplates={mappingTemplates}
          onClose={() => setOpen(false)}
        />
      </DialogContent>
    </Dialog>
  );
}
