"use client";

import { useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Archive, ArchiveRestore, Copy, ExternalLink, Loader2, MoreHorizontal, Pencil, Search, Trash2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import { cn } from "@/lib/utils";
import { applyLibraryQuery, type LibraryQuery, type LibrarySession, type SessionKind } from "@/domain/simulation/session-library";
import { deleteSessionAction, duplicateSessionAction, renameSessionAction, sessionDeletionImpactAction, setSessionArchivedAction } from "@/actions/session-library.actions";

const KIND_LABEL: Record<SessionKind, string> = { LAB: "Strategy Lab", PROP: "Prop Firm", LEGACY: "Legacy run" };
const SORTS: { value: NonNullable<LibraryQuery["sort"]>; label: string }[] = [
  { value: "updated", label: "Last updated" },
  { value: "created", label: "Newest" },
  { value: "name", label: "Name" },
  { value: "trades", label: "Most trades" },
];
const fmtDate = (iso: string) => new Date(iso).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });

type Impact = { trades: number; orders: number; drawings: number; observations: number; allowed: boolean; note: string | null };

export function SessionLibrary({ sessions }: { sessions: LibrarySession[] }) {
  const router = useRouter();
  const [q, setQ] = useState("");
  const [kind, setKind] = useState<SessionKind | "ALL">("ALL");
  const [scope, setScope] = useState<NonNullable<LibraryQuery["scope"]>>("active");
  const [sort, setSort] = useState<NonNullable<LibraryQuery["sort"]>>("updated");
  const [pending, start] = useTransition();
  const [rename, setRename] = useState<{ s: LibrarySession; name: string } | null>(null);
  const [archive, setArchive] = useState<LibrarySession | null>(null);
  const [del, setDel] = useState<{ s: LibrarySession; impact: Impact | null; typed: string } | null>(null);

  const list = useMemo(() => applyLibraryQuery(sessions, { q, kind, scope, sort }), [sessions, q, kind, scope, sort]);
  const archivedCount = sessions.filter((s) => s.archived).length;

  const run = (fn: () => Promise<{ success: boolean; error?: string }>, ok: string, after?: () => void) =>
    start(async () => {
      const res = await fn();
      if (!res.success) return void toast.error(res.error ?? "Something went wrong.");
      toast.success(ok);
      after?.();
      router.refresh();
    });

  const openDelete = async (s: LibrarySession) => {
    setDel({ s, impact: null, typed: "" });
    const res = await sessionDeletionImpactAction({ kind: s.kind, id: s.id });
    if (!res.success) {
      setDel(null);
      return void toast.error(res.error);
    }
    setDel((d) => (d && d.s.id === s.id ? { ...d, impact: res.impact } : d));
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-52 flex-1">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" aria-hidden />
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search by name or instrument" aria-label="Search sessions" className="h-9 pl-8" />
        </div>
        <select aria-label="Type" value={kind} onChange={(e) => setKind(e.target.value as SessionKind | "ALL")} className="h-9 rounded-md border border-border bg-background px-2 text-sm">
          <option value="ALL">All types</option>
          {(Object.keys(KIND_LABEL) as SessionKind[]).map((k) => (
            <option key={k} value={k}>{KIND_LABEL[k]}</option>
          ))}
        </select>
        <select aria-label="Sort by" value={sort} onChange={(e) => setSort(e.target.value as typeof sort)} className="h-9 rounded-md border border-border bg-background px-2 text-sm">
          {SORTS.map((s) => (
            <option key={s.value} value={s.value}>{s.label}</option>
          ))}
        </select>
        <div role="tablist" aria-label="Show" className="flex rounded-md border border-border p-0.5">
          {(["active", "archived", "all"] as const).map((v) => (
            <button key={v} role="tab" type="button" aria-selected={scope === v} onClick={() => setScope(v)} className={cn("rounded-[5px] px-2.5 py-1 text-xs", scope === v ? "bg-foreground text-background" : "text-muted-foreground hover:text-foreground")}>
              {v === "active" ? "Active" : v === "archived" ? `Archived${archivedCount ? ` (${archivedCount})` : ""}` : "All"}
            </button>
          ))}
        </div>
      </div>

      {list.length === 0 ? (
        <p className="rounded-lg border border-dashed border-border px-4 py-10 text-center text-sm text-muted-foreground">
          {sessions.length === 0 ? "No backtests yet. Start one in Strategy Lab or the Prop Firm Simulator." : scope === "archived" ? "Nothing archived." : "No sessions match."}
        </p>
      ) : (
        <ul className="divide-y divide-border overflow-hidden rounded-lg border border-border bg-card" aria-label="Sessions">
          {list.map((s) => (
            <li key={`${s.kind}-${s.id}`} className={cn("flex flex-wrap items-center gap-x-4 gap-y-1 px-4 py-3", s.archived && "opacity-70")}>
              <div className="min-w-0 flex-1 basis-64">
                <div className="flex items-center gap-2">
                  <Link href={s.href} className="truncate font-medium hover:underline">{s.name}</Link>
                  <span className="shrink-0 rounded border border-border px-1.5 py-px text-[10px] uppercase tracking-wide text-muted-foreground">{KIND_LABEL[s.kind]}</span>
                  {s.archived && <span className="shrink-0 rounded bg-muted px-1.5 py-px text-[10px] uppercase tracking-wide text-muted-foreground">Archived</span>}
                </div>
                <p className="truncate text-xs text-muted-foreground">
                  {s.assets.join(", ")} · {s.periodStart} → {s.periodEnd}
                  {s.clock && <> · at <span className="font-mono">{s.clock.replace("T", " ")}</span></>}
                </p>
              </div>
              <span className="w-24 text-xs text-muted-foreground">{s.status.charAt(0) + s.status.slice(1).toLowerCase()}</span>
              <span className="w-32 font-mono text-xs tabular-nums text-muted-foreground">
                {s.counts.trades} trade{s.counts.trades === 1 ? "" : "s"} · {s.counts.drawings} dr.
              </span>
              <span className="w-28 text-xs text-muted-foreground" title={`Updated ${new Date(s.updatedAt).toLocaleString()}`}>{fmtDate(s.updatedAt)}</span>
              <DropdownMenu>
                <DropdownMenuTrigger render={<Button variant="ghost" size="icon-sm" aria-label={`Actions for ${s.name}`} />} disabled={pending}>
                  <MoreHorizontal />
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-48">
                  <DropdownMenuItem onClick={() => router.push(s.href)}>
                    <ExternalLink /> Open
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => setRename({ s, name: s.name })}>
                    <Pencil /> Rename
                  </DropdownMenuItem>
                  {s.can.duplicate && (
                    <DropdownMenuItem onClick={() => run(() => duplicateSessionAction({ kind: s.kind, id: s.id }), "Duplicated — a fresh copy with the same data and settings.")}>
                      <Copy /> Duplicate
                    </DropdownMenuItem>
                  )}
                  {s.archived ? (
                    <DropdownMenuItem onClick={() => run(() => setSessionArchivedAction({ kind: s.kind, id: s.id, archived: false }), "Restored.")}>
                      <ArchiveRestore /> Restore
                    </DropdownMenuItem>
                  ) : (
                    <DropdownMenuItem onClick={() => setArchive(s)}>
                      <Archive /> Archive
                    </DropdownMenuItem>
                  )}
                  <DropdownMenuSeparator />
                  <DropdownMenuItem variant="destructive" disabled={!s.can.delete} onClick={() => void openDelete(s)} title={s.deleteNote ?? undefined}>
                    <Trash2 /> Delete{!s.can.delete && " (archive only)"}
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </li>
          ))}
        </ul>
      )}

      <Dialog open={rename != null} onOpenChange={(o) => !o && setRename(null)}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Rename</DialogTitle>
            <DialogDescription>Only the name changes; history and settings stay as they are.</DialogDescription>
          </DialogHeader>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (rename) run(() => renameSessionAction({ kind: rename.s.kind, id: rename.s.id, name: rename.name }), "Renamed.", () => setRename(null));
            }}
            className="space-y-3"
          >
            <Input autoFocus maxLength={120} value={rename?.name ?? ""} onChange={(e) => rename && setRename({ ...rename, name: e.target.value })} aria-label="Name" />
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setRename(null)}>Cancel</Button>
              <Button type="submit" disabled={pending || !rename?.name.trim()}>{pending && <Loader2 className="animate-spin" />}Save</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={archive != null}
        onOpenChange={(o) => !o && setArchive(null)}
        title="Archive this session?"
        description={`"${archive?.name ?? ""}" leaves your active list. Nothing is deleted — trades, drawings and results are kept, and you can restore it from the Archived tab at any time.`}
        confirmLabel="Archive"
        isPending={pending}
        onConfirm={() => archive && run(() => setSessionArchivedAction({ kind: archive.kind, id: archive.id, archived: true }), "Archived.", () => setArchive(null))}
      />

      <Dialog open={del != null} onOpenChange={(o) => !o && !pending && setDel(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Delete “{del?.s.name}”?</DialogTitle>
            <DialogDescription>This can&apos;t be undone. If you might want it later, archive it instead.</DialogDescription>
          </DialogHeader>
          {!del?.impact ? (
            <p className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="size-4 animate-spin" /> Checking what it holds…</p>
          ) : !del.impact.allowed ? (
            <p className="text-sm text-amber-500">{del.impact.note}</p>
          ) : (
            <div className="space-y-3 text-sm">
              <p>Permanently deleted with it:</p>
              <ul className="list-inside list-disc text-muted-foreground">
                <li>{del.impact.trades} {del.s.kind === "LEGACY" ? "journaled trade" : "position"}{del.impact.trades === 1 ? "" : "s"}{del.s.kind !== "LEGACY" && <> and {del.impact.orders} order{del.impact.orders === 1 ? "" : "s"}, with fills and the account ledger</>}</li>
                <li>{del.impact.drawings} chart drawing{del.impact.drawings === 1 ? "" : "s"}</li>
                {del.s.kind === "LEGACY" && <li>its days, notes, analyses and screenshots</li>}
              </ul>
              {del.impact.observations > 0 && <p className="text-muted-foreground">{del.impact.observations} study observation{del.impact.observations === 1 ? " is" : "s are"} kept in its study, without the link to this account.</p>}
              <label className="block space-y-1">
                <span className="text-xs text-muted-foreground">Type the name to confirm</span>
                <Input value={del.typed} onChange={(e) => setDel({ ...del, typed: e.target.value })} aria-label="Type the name to confirm" />
              </label>
            </div>
          )}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setDel(null)} disabled={pending}>Cancel</Button>
            <Button
              type="button"
              variant="destructive"
              disabled={pending || !del?.impact?.allowed || del.typed.trim() !== del.s.name.trim()}
              onClick={() => del && run(() => deleteSessionAction({ kind: del.s.kind, id: del.s.id, confirm: true }), "Deleted.", () => setDel(null))}
            >
              {pending && <Loader2 className="animate-spin" />}Delete permanently
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
