"use client";

import { useState, type ReactNode } from "react";

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Input } from "@/components/ui/input";

/**
 * A destructive confirmation that only enables its action once the user types an
 * exact phrase (e.g. DELETE or RESET TRADITORIUM). The `description` slot takes rich
 * content so a card can spell out precisely what will be removed. Used for the
 * irreversible Data Management actions.
 */
export function TypeToConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  phrase,
  confirmLabel,
  isPending = false,
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: ReactNode;
  phrase: string;
  confirmLabel: string;
  isPending?: boolean;
  onConfirm: () => void;
}) {
  // The caller remounts this dialog (via `key`) when the target changes, so the
  // typed phrase never carries over between actions — no reset effect needed.
  const [typed, setTyped] = useState("");
  const matches = typed.trim() === phrase;

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          <AlertDialogDescription render={<div className="space-y-2" />}>
            {description}
          </AlertDialogDescription>
        </AlertDialogHeader>

        <div className="space-y-1.5">
          <label className="text-xs text-muted-foreground">
            Type <span className="font-semibold text-foreground">{phrase}</span> to confirm — this
            cannot be undone.
          </label>
          <Input
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
            placeholder={phrase}
            aria-label={`Type ${phrase} to confirm`}
            autoComplete="off"
            spellCheck={false}
            disabled={isPending}
          />
        </div>

        <AlertDialogFooter>
          <AlertDialogCancel disabled={isPending}>Cancel</AlertDialogCancel>
          <AlertDialogAction
            disabled={isPending || !matches}
            className="bg-danger text-danger-foreground hover:bg-danger/90"
            onClick={(e) => {
              e.preventDefault();
              if (matches) onConfirm();
            }}
          >
            {confirmLabel}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
