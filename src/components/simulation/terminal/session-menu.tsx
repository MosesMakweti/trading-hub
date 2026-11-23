"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Archive, Library, Loader2, MoreHorizontal, Trash2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { deleteSessionAction, sessionDeletionImpactAction, setSessionArchivedAction } from "@/actions/session-library.actions";

export const LIBRARY_HREF = "/backtesting/sessions";

interface Impact {
  trades: number;
  orders: number;
  drawings: number;
  observations: number;
  allowed: boolean;
  note: string | null;
}

/**
 * Archive or delete the session that is open. Before anything is sent the
 * terminal is quiesced (`prepare`): playback stopped and settled, drawing
 * saves finished, and late requests silenced — so nothing keeps running
 * against a deleted session. Then the trader goes back to the library.
 */
export function SessionMenu({
  session,
  prepare,
  release,
}: {
  session: { id: string; name: string; kind: "LAB" | "PROP" };
  /** Stop playback, wait for in-flight saves; resolves with how many saves didn't finish in time. */
  prepare: () => Promise<{ unsaved: number }>;
  /** The action failed: the terminal may carry on. */
  release: () => void;
}) {
  const router = useRouter();
  const [dialog, setDialog] = useState<"archive" | "delete" | null>(null);
  const [impact, setImpact] = useState<Impact | null>(null);
  const [unsaved, setUnsaved] = useState(0);
  const [busy, setBusy] = useState(false);

  const open = async (which: "archive" | "delete") => {
    setDialog(which);
    setImpact(null);
    const { unsaved: n } = await prepare();
    setUnsaved(n);
    if (which === "delete") {
      const res = await sessionDeletionImpactAction({ kind: session.kind, id: session.id });
      if (!res.success) {
        toast.error(res.error);
        setDialog(null);
        release();
        return;
      }
      setImpact(res.impact);
    }
  };

  const close = () => {
    if (busy) return;
    setDialog(null);
    release();
  };

  const confirm = async () => {
    if (busy) return; // one request only
    setBusy(true);
    const ref = { kind: session.kind, id: session.id };
    const res = dialog === "delete" ? await deleteSessionAction({ ...ref, confirm: true }) : await setSessionArchivedAction({ ...ref, archived: true });
    if (!res.success && !("gone" in res && res.gone)) {
      setBusy(false);
      toast.error(res.error);
      return; // nothing changed: stay in the session
    }
    toast.success(dialog === "delete" ? `Deleted “${session.name}”.` : `Archived “${session.name}”. You can restore it from the session library.`);
    router.replace(LIBRARY_HREF);
    router.refresh();
  };

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger render={<Button variant="ghost" size="icon-sm" aria-label="Session actions" />}>
          <MoreHorizontal />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-52">
          <DropdownMenuItem onClick={() => router.push(LIBRARY_HREF)}>
            <Library /> All sessions
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={() => void open("archive")}>
            <Archive /> Archive session
          </DropdownMenuItem>
          <DropdownMenuItem variant="destructive" disabled={session.kind === "PROP"} onClick={() => void open("delete")} title={session.kind === "PROP" ? "Prop Firm accounts are financial records: archive them instead." : undefined}>
            <Trash2 /> Delete session{session.kind === "PROP" && " (archive only)"}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <Dialog open={dialog != null} onOpenChange={(o) => !o && close()}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{dialog === "delete" ? "Delete Backtesting Session?" : "Archive this session?"}</DialogTitle>
            <DialogDescription>
              {dialog === "delete" ? (
                <>
                  Are you sure you want to permanently delete <span className="font-semibold text-foreground">“{session.name}”</span>? This action will remove the session and its associated data. This cannot be undone.
                </>
              ) : (
                <>
                  <span className="font-semibold text-foreground">“{session.name}”</span> leaves your active list. Nothing is deleted, and you can restore it from the session library at any time.
                </>
              )}
            </DialogDescription>
          </DialogHeader>
          <p className="text-xs text-muted-foreground">Playback has been paused.</p>
          {unsaved > 0 && (
            <p className="rounded-md border border-amber-500/30 bg-amber-500/10 px-2 py-1.5 text-xs text-amber-500" role="alert">
              {unsaved} drawing change{unsaved === 1 ? " is" : "s are"} still saving. {dialog === "delete" ? "They belong to this session and will be deleted with it." : "Wait a moment before archiving if you want to keep them."}
            </p>
          )}
          {dialog === "delete" &&
            (!impact ? (
              <p className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="size-4 animate-spin" /> Checking what it holds…</p>
            ) : (
              <div className="space-y-1 rounded-md border border-border bg-muted/30 p-3 text-sm">
                <p className="font-medium">Deleted with it:</p>
                <ul className="list-inside list-disc text-muted-foreground">
                  <li>{impact.trades} trade{impact.trades === 1 ? "" : "s"}, {impact.orders} order{impact.orders === 1 ? "" : "s"}, their fills and the account ledger</li>
                  <li>{impact.drawings} chart drawing{impact.drawings === 1 ? "" : "s"} and its replay position</li>
                </ul>
                {impact.observations > 0 && <p className="text-xs text-muted-foreground">Kept: {impact.observations} study observation{impact.observations === 1 ? "" : "s"} stay in their study.</p>}
              </div>
            ))}
          <DialogFooter>
            <Button type="button" variant="outline" autoFocus onClick={close} disabled={busy}>Cancel</Button>
            <Button type="button" variant={dialog === "delete" ? "destructive" : "default"} disabled={busy || (dialog === "delete" && !impact?.allowed)} onClick={() => void confirm()}>
              {busy ? <Loader2 className="animate-spin" /> : dialog === "delete" ? <Trash2 /> : <Archive />}
              {dialog === "delete" ? "Delete permanently" : "Archive"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
