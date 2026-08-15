"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ArchiveRestore, Archive as ArchiveIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { FormField } from "@/components/accounts/form-field";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import {
  archivePropFirmAccountAction,
  reactivatePropFirmAccountAction,
  updatePropFirmAccountAction,
} from "@/actions/prop-firms.actions";
import type { PropFirmAccountDTO } from "@/types/prop-firms";

export function SettingsTab({ account }: { account: PropFirmAccountDTO }) {
  const router = useRouter();
  const [modelName, setModelName] = useState(account.modelName ?? "");
  const [platform, setPlatform] = useState(account.platform ?? "");
  const [dataFeed, setDataFeed] = useState(account.dataFeed ?? "");
  const [notes, setNotes] = useState(account.notes ?? "");
  const [confirmArchive, setConfirmArchive] = useState(false);
  const [isSaving, startSave] = useTransition();
  const [isArchiving, startArchive] = useTransition();

  function handleSave() {
    startSave(async () => {
      const result = await updatePropFirmAccountAction(account.id, {
        modelName: modelName.trim() || undefined,
        platform: platform.trim() || undefined,
        dataFeed: dataFeed.trim() || undefined,
        notes: notes.trim() || undefined,
      });
      if (!result.success) {
        toast.error(result.error);
        return;
      }
      toast.success("Account updated.");
      router.refresh();
    });
  }

  function handleArchiveToggle() {
    startArchive(async () => {
      const result =
        account.status === "ARCHIVED"
          ? await reactivatePropFirmAccountAction(account.id)
          : await archivePropFirmAccountAction(account.id);
      if (!result.success) {
        toast.error(result.error);
        return;
      }
      toast.success(account.status === "ARCHIVED" ? "Account reactivated." : "Account archived.");
      setConfirmArchive(false);
      router.refresh();
    });
  }

  return (
    <div className="space-y-4">
      <div className="glass space-y-3 rounded-2xl p-4">
        <FormField label="Model name">
          <Input value={modelName} onChange={(e) => setModelName(e.target.value)} />
        </FormField>
        <FormField label="Platform">
          <Input value={platform} onChange={(e) => setPlatform(e.target.value)} />
        </FormField>
        <FormField label="Broker / data feed">
          <Input value={dataFeed} onChange={(e) => setDataFeed(e.target.value)} />
        </FormField>
        <FormField label="Notes">
          <Textarea rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} />
        </FormField>
        <div className="flex justify-end">
          <Button type="button" onClick={handleSave} disabled={isSaving}>
            {isSaving ? "Saving…" : "Save changes"}
          </Button>
        </div>
      </div>

      <div className="glass flex items-center justify-between rounded-2xl p-4">
        <div>
          <div className="text-sm font-medium">
            {account.status === "ARCHIVED" ? "Reactivate this account" : "Archive this account"}
          </div>
          <p className="text-xs text-muted-foreground">
            {account.status === "ARCHIVED"
              ? "Bring this account back into active tracking."
              : "Archiving keeps full history — it's not a delete, and can be undone anytime."}
          </p>
        </div>
        <Button
          type="button"
          variant="outline"
          className="gap-1.5"
          onClick={() => (account.status === "ARCHIVED" ? handleArchiveToggle() : setConfirmArchive(true))}
          disabled={isArchiving}
        >
          {account.status === "ARCHIVED" ? <ArchiveRestore className="size-3.5" /> : <ArchiveIcon className="size-3.5" />}
          {account.status === "ARCHIVED" ? "Reactivate" : "Archive"}
        </Button>
      </div>

      <ConfirmDialog
        open={confirmArchive}
        onOpenChange={setConfirmArchive}
        title="Archive this account?"
        description={`"${account.displayName}" will be marked archived. All history stays intact and it can be reactivated anytime.`}
        confirmLabel="Archive"
        isPending={isArchiving}
        onConfirm={handleArchiveToggle}
      />
    </div>
  );
}
