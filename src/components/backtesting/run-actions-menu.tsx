"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Archive, ArchiveRestore, CheckCircle2, Download, MoreHorizontal, RotateCcw, Trash2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import { deleteBacktestRunAction, setBacktestRunStatusAction } from "@/actions/backtesting.actions";
import type { BacktestRunStatusValue } from "@/types/backtesting";

/**
 * Run lifecycle actions, shared by the Overview cards and the run header.
 * Completing and archiving are explicit trader decisions (nothing completes a
 * run automatically); delete is confirmed and permanent.
 */
export function RunActionsMenu({
  run,
  afterDeleteHref,
}: {
  run: { id: string; name: string; status: BacktestRunStatusValue };
  /** Where to go after deleting (the run's own pages no longer exist). */
  afterDeleteHref?: string;
}) {
  const router = useRouter();
  const [confirm, setConfirm] = useState<"complete" | "archive" | "delete" | null>(null);
  const [isPending, startTransition] = useTransition();

  function changeStatus(status: BacktestRunStatusValue, message: string) {
    startTransition(async () => {
      const result = await setBacktestRunStatusAction(run.id, status);
      if (!result.success) {
        toast.error(result.error);
        return;
      }
      setConfirm(null);
      toast.success(message);
      router.refresh();
    });
  }

  function handleDelete() {
    startTransition(async () => {
      const result = await deleteBacktestRunAction(run.id);
      if (!result.success) {
        toast.error(result.error);
        return;
      }
      setConfirm(null);
      toast.success("Backtest run deleted.");
      if (afterDeleteHref) router.push(afterDeleteHref);
      router.refresh();
    });
  }

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger
          render={<Button variant="ghost" size="icon-sm" aria-label={`Actions for ${run.name}`} />}
          disabled={isPending}
        >
          <MoreHorizontal />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-48">
          {run.status === "ACTIVE" && (
            <DropdownMenuItem onClick={() => setConfirm("complete")}>
              <CheckCircle2 />
              Mark as completed
            </DropdownMenuItem>
          )}
          {run.status === "COMPLETED" && (
            <DropdownMenuItem onClick={() => changeStatus("ACTIVE", "Run reopened.")}>
              <RotateCcw />
              Reopen run
            </DropdownMenuItem>
          )}
          {run.status === "ARCHIVED" ? (
            <DropdownMenuItem onClick={() => changeStatus("ACTIVE", "Run restored.")}>
              <ArchiveRestore />
              Restore
            </DropdownMenuItem>
          ) : (
            <DropdownMenuItem onClick={() => setConfirm("archive")}>
              <Archive />
              Archive
            </DropdownMenuItem>
          )}
          <DropdownMenuItem render={<a href={`/api/export/trades?runId=${run.id}&format=csv`} download />}>
            <Download />
            Export trades (CSV)
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem variant="destructive" onClick={() => setConfirm("delete")}>
            <Trash2 />
            Delete
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <ConfirmDialog
        open={confirm === "complete"}
        onOpenChange={(open) => !open && setConfirm(null)}
        title="Mark this run as completed?"
        description={`"${run.name}" moves to Completed. Its journal, trades and analytics stay available, and you can reopen it at any time.`}
        confirmLabel="Mark completed"
        isPending={isPending}
        onConfirm={() => changeStatus("COMPLETED", "Run marked as completed.")}
      />
      <ConfirmDialog
        open={confirm === "archive"}
        onOpenChange={(open) => !open && setConfirm(null)}
        title="Archive this run?"
        description={`"${run.name}" leaves your active runs. Every simulated day, trade and screenshot is kept, and you can restore it at any time.`}
        confirmLabel="Archive"
        isPending={isPending}
        onConfirm={() => changeStatus("ARCHIVED", "Run archived.")}
      />
      <ConfirmDialog
        open={confirm === "delete"}
        onOpenChange={(open) => !open && setConfirm(null)}
        title="Delete this backtest run?"
        description={`"${run.name}" and all of its simulated days, trades, reviews and screenshots will be permanently deleted. Your live trading data is not affected. This can't be undone.`}
        confirmLabel="Delete run"
        variant="destructive"
        isPending={isPending}
        onConfirm={handleDelete}
      />
    </>
  );
}
