"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  Archive,
  ArchiveRestore,
  Copy,
  MoreHorizontal,
  Pencil,
  Trash2,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import { TAG_STYLES, colorForName } from "@/components/ui/tag";
import { cn } from "@/lib/utils";
import { StrategyStatusBadge } from "@/components/strategy-lab/strategy-status-badge";
import { RenameStrategyDialog } from "@/components/strategy-lab/rename-strategy-dialog";
import {
  deleteStrategy,
  duplicateStrategy,
  setStrategyStatus,
} from "@/actions/strategies.actions";
import type { StrategyDTO } from "@/types/strategies";

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

export function StrategyCard({ strategy }: { strategy: StrategyDTO }) {
  const router = useRouter();
  const [renameOpen, setRenameOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [isPending, startTransition] = useTransition();

  const isArchived = strategy.status === "ARCHIVED";

  function handleDuplicate() {
    startTransition(async () => {
      const result = await duplicateStrategy(strategy.id);
      if (!result.success) {
        toast.error(result.error);
        return;
      }
      toast.success("Strategy duplicated.");
      router.refresh();
    });
  }

  function handleArchiveToggle() {
    startTransition(async () => {
      const result = await setStrategyStatus(strategy.id, isArchived ? "DRAFT" : "ARCHIVED");
      if (!result.success) {
        toast.error(result.error);
        return;
      }
      toast.success(isArchived ? "Strategy restored." : "Strategy archived.");
      router.refresh();
    });
  }

  function handleDelete() {
    startTransition(async () => {
      const result = await deleteStrategy(strategy.id);
      if (!result.success) {
        toast.error(result.error);
        return;
      }
      setDeleteOpen(false);
      toast.success("Strategy deleted.");
      router.refresh();
    });
  }

  return (
    <div
      className="glass flex h-full flex-col gap-3 rounded-2xl p-4 transition-all duration-300 hover:-translate-y-0.5 hover:shadow-elevated data-[archived=true]:opacity-70"
      data-archived={isArchived}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 space-y-1">
          <Link
            href={`/strategy-lab/${strategy.id}`}
            className="block truncate font-semibold hover:underline"
          >
            {strategy.name}
          </Link>
          <StrategyStatusBadge status={strategy.status} />
        </div>

        <DropdownMenu>
          <DropdownMenuTrigger
            render={<Button variant="ghost" size="icon-sm" aria-label="Strategy actions" />}
            disabled={isPending}
          >
            <MoreHorizontal />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-44">
            <DropdownMenuItem render={<Link href={`/strategy-lab/${strategy.id}`} />}>
              <Pencil />
              Open
            </DropdownMenuItem>
            <DropdownMenuItem onClick={handleDuplicate}>
              <Copy />
              Duplicate
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => setRenameOpen(true)}>
              <Pencil />
              Rename
            </DropdownMenuItem>
            <DropdownMenuItem onClick={handleArchiveToggle}>
              {isArchived ? <ArchiveRestore /> : <Archive />}
              {isArchived ? "Restore" : "Archive"}
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem variant="destructive" onClick={() => setDeleteOpen(true)}>
              <Trash2 />
              Delete
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {strategy.description ? (
        <p className="line-clamp-2 text-sm text-muted-foreground">{strategy.description}</p>
      ) : (
        <p className="text-sm text-muted-foreground/60 italic">No description yet.</p>
      )}

      {strategy.applicableAssets.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {strategy.applicableAssets.slice(0, 6).map((asset) => (
            <span
              key={asset}
              className={cn(
                "inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 font-mono text-[11px]",
                TAG_STYLES[colorForName(asset)].chip,
              )}
            >
              <span className={cn("size-1.5 rounded-full", TAG_STYLES[colorForName(asset)].dot)} />
              {asset}
            </span>
          ))}
          {strategy.applicableAssets.length > 6 && (
            <span className="px-1 py-0.5 text-[11px] text-muted-foreground">
              +{strategy.applicableAssets.length - 6}
            </span>
          )}
        </div>
      )}

      <div className="mt-auto flex items-center justify-between gap-2 border-t border-border pt-3">
        <span className="text-[11px] text-muted-foreground">
          Updated {formatDate(strategy.updatedAt)}
        </span>
        <Button
          size="sm"
          variant="outline"
          nativeButton={false}
          render={<Link href={`/strategy-lab/${strategy.id}`} />}
        >
          Open
        </Button>
      </div>

      <RenameStrategyDialog
        strategyId={strategy.id}
        currentName={strategy.name}
        open={renameOpen}
        onOpenChange={setRenameOpen}
      />
      <ConfirmDialog
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        title="Delete this strategy?"
        description={`"${strategy.name}" and everything inside it will be removed. This can't be undone from here.`}
        confirmLabel="Delete"
        variant="destructive"
        isPending={isPending}
        onConfirm={handleDelete}
      />
    </div>
  );
}
