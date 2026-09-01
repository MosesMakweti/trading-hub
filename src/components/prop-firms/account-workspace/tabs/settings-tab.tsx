"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ArchiveRestore, Archive as ArchiveIcon, Trash2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { FormField } from "@/components/accounts/form-field";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import {
  archivePropFirmAccountAction,
  deletePropFirmAccountAction,
  reactivatePropFirmAccountAction,
  updatePropFirmAccountAction,
} from "@/actions/prop-firms.actions";
import type { PropFirmAccountDTO } from "@/types/prop-firms";

export function SettingsTab({ account, firmId }: { account: PropFirmAccountDTO; firmId: string }) {
  const router = useRouter();
  const [modelName, setModelName] = useState(account.modelName ?? "");
  const [notes, setNotes] = useState(account.notes ?? "");
  const [confirmArchive, setConfirmArchive] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [isSaving, startSave] = useTransition();
  const [isArchiving, startArchive] = useTransition();
  const [isDeleting, startDelete] = useTransition();

  function handleSave() {
    startSave(async () => {
      const result = await updatePropFirmAccountAction(account.id, {
        modelName: modelName.trim() || undefined,
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

  function handleDelete() {
    startDelete(async () => {
      const result = await deletePropFirmAccountAction(account.id);
      if (!result.success) {
        toast.error(result.error);
        return;
      }
      toast.success("Account deleted.");
      router.push(`/prop-firms/${firmId}`);
      router.refresh();
    });
  }

  return (
    <div className="space-y-4">
      <div className="glass space-y-3 rounded-2xl p-4">
        <FormField label="Model name">
          <Input value={modelName} onChange={(e) => setModelName(e.target.value)} />
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

      <div className="glass flex items-center justify-between rounded-2xl border border-danger/20 p-4">
        <div>
          <div className="text-sm font-medium">Delete this account</div>
          <p className="text-xs text-muted-foreground">
            Removes it from Prop Firms and account selectors everywhere. This can&apos;t be undone from here.
          </p>
        </div>
        <Button
          type="button"
          variant="destructive"
          className="gap-1.5"
          onClick={() => setConfirmDelete(true)}
          disabled={isDeleting}
        >
          <Trash2 className="size-3.5" />
          Delete
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

      <ConfirmDialog
        open={confirmDelete}
        onOpenChange={setConfirmDelete}
        title="Delete this account?"
        description={`"${account.displayName}" will be removed from Prop Firms and account selectors. This can't be undone from here.`}
        confirmLabel="Delete"
        variant="destructive"
        isPending={isDeleting}
        onConfirm={handleDelete}
      />
    </div>
  );
}
