"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Loader2, Trash2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { deleteSessionAction, sessionDeletionImpactAction } from "@/actions/session-library.actions";

interface Impact {
  trades: number;
  orders: number;
  drawings: number;
  observations: number;
  allowed: boolean;
  note: string | null;
}

/**
 * A visible "Delete" for one backtesting session, wherever the session is
 * shown (cards, challenge page). Same confirmation as the session library;
 * the server checks ownership and removes the session with its data.
 */
export function DeleteSessionButton({
  kind,
  id,
  name,
  label = "Delete",
  iconOnly = false,
  redirectTo,
  className,
}: {
  kind: "LAB" | "PROP" | "LEGACY";
  id: string;
  name: string;
  label?: string;
  iconOnly?: boolean;
  /** Where to go afterwards (the page showing the session no longer exists); otherwise refresh. */
  redirectTo?: string;
  className?: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [impact, setImpact] = useState<Impact | null>(null);
  const [busy, setBusy] = useState(false);

  const start = async (e: React.MouseEvent) => {
    e.preventDefault(); // inside a card link: don't navigate
    e.stopPropagation();
    setOpen(true);
    setImpact(null);
    const res = await sessionDeletionImpactAction({ kind, id });
    if (!res.success) {
      setOpen(false);
      return void toast.error(res.error);
    }
    setImpact(res.impact);
  };

  const confirm = async () => {
    if (busy) return;
    setBusy(true);
    const res = await deleteSessionAction({ kind, id, confirm: true });
    if (!res.success && !("gone" in res && res.gone)) {
      setBusy(false);
      return void toast.error(res.error);
    }
    toast.success(`Deleted “${name}”.`);
    setOpen(false);
    setBusy(false);
    if (redirectTo) router.replace(redirectTo);
    router.refresh();
  };

  return (
    <>
      <Button
        type="button"
        variant="ghost"
        size={iconOnly ? "icon-sm" : "sm"}
        onClick={(e) => void start(e)}
        aria-label={`${label} ${name}`}
        title={`${label} permanently`}
        className={cn("text-muted-foreground hover:bg-red-500/10 hover:text-red-500", className)}
      >
        <Trash2 />
        {!iconOnly && label}
      </Button>
      <Dialog open={open} onOpenChange={(o) => !o && !busy && setOpen(false)}>
        <DialogContent className="sm:max-w-md" onClick={(e) => e.stopPropagation()}>
          <DialogHeader>
            <DialogTitle>Delete Backtesting Session?</DialogTitle>
            <DialogDescription>
              Are you sure you want to permanently delete <span className="font-semibold text-foreground">“{name}”</span>? This action will remove the session and its associated data. This cannot be undone.
            </DialogDescription>
          </DialogHeader>
          {!impact ? (
            <p className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="size-4 animate-spin" /> Checking what it holds…</p>
          ) : (
            <div className="space-y-1 rounded-md border border-border bg-muted/30 p-3 text-sm">
              {impact.note && <p className="font-medium text-amber-500">{impact.note}</p>}
              <p className="font-medium">Deleted with it:</p>
              <ul className="list-inside list-disc text-muted-foreground">
                <li>
                  {impact.trades} trade{impact.trades === 1 ? "" : "s"}
                  {kind !== "LEGACY" && <>, {impact.orders} order{impact.orders === 1 ? "" : "s"}, their fills and balances</>}
                </li>
                <li>{impact.drawings} chart drawing{impact.drawings === 1 ? "" : "s"}</li>
              </ul>
              {impact.observations > 0 && <p className="text-xs text-muted-foreground">Kept: {impact.observations} study observation{impact.observations === 1 ? "" : "s"} stay in their study.</p>}
            </div>
          )}
          <DialogFooter>
            <Button type="button" variant="outline" autoFocus onClick={() => setOpen(false)} disabled={busy}>Cancel</Button>
            <Button type="button" variant="destructive" disabled={busy || !impact?.allowed} onClick={() => void confirm()}>
              {busy ? <Loader2 className="animate-spin" /> : <Trash2 />}Delete permanently
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
