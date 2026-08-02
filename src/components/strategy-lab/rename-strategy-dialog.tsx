"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { renameStrategy } from "@/actions/strategies.actions";

export function RenameStrategyDialog({
  strategyId,
  currentName,
  open,
  onOpenChange,
}: {
  strategyId: string;
  currentName: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const name = (new FormData(e.currentTarget).get("name")?.toString() ?? "").trim();
    if (!name) return;
    startTransition(async () => {
      const result = await renameStrategy(strategyId, { name });
      if (!result.success) {
        toast.error(result.error);
        return;
      }
      onOpenChange(false);
      router.refresh();
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Rename strategy</DialogTitle>
          <DialogDescription>Only the name changes — everything else stays put.</DialogDescription>
        </DialogHeader>
        {/* Uncontrolled + keyed so the field re-seeds with the latest name each
            time the dialog opens, without a reset-in-effect. */}
        <form onSubmit={handleSubmit} className="space-y-4" key={`${open}-${currentName}`}>
          <div className="space-y-1.5">
            <Label htmlFor="rename-strategy" className="text-xs">
              Strategy name
            </Label>
            <Input id="rename-strategy" name="name" autoFocus defaultValue={currentName} />
          </div>
          <DialogFooter>
            <Button type="submit" disabled={isPending}>
              {isPending ? "Saving…" : "Save"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
