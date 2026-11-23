"use client";

import { useMemo, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Archive, ArchiveRestore, Copy, ExternalLink, Loader2, MoreHorizontal, Pencil, Search, Trash2, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import { cn } from "@/lib/utils";
import { applyLibraryQuery, type LibraryQuery, type LibrarySession, type SessionKind } from "@/domain/simulation/session-library";
import {
  bulkArchiveSessionsAction,
  bulkDeleteSessionsAction,
  deleteSessionAction,
  duplicateSessionAction,
  renameSessionAction,
  sessionDeletionImpactAction,
  setSessionArchivedAction,
} from "@/actions/session-library.actions";

const KIND_LABEL: Record<SessionKind, string> = { LAB: "Strategy Lab", PROP: "Prop Firm", LEGACY: "Legacy run" };
const SORTS: { value: NonNullable<LibraryQuery["sort"]>; label: string }[] = [
  { value: "updated", label: "Last updated" },
  { value: "created", label: "Newest" },
  { value: "name", label: "Name" },
  { value: "trades", label: "Most trades" },
  { value: "result", label: "Best result" },
];
const fmtDate = (iso: string) => new Date(iso).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
const keyOf = (s: Pick<LibrarySession, "kind" | "id">) => `${s.kind}:${s.id}`;
const money = (v: number, ccy: string) => `${v >= 0 ? "+" : "−"}${Math.abs(v).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${ccy}`;

type Impact = { trades: number; orders: number; drawings: number; observations: number; allowed: boolean; note: string | null };

/**
 * Every backtesting session in one list: search, filter, sort; open, rename,
 * duplicate, archive/restore and delete — one at a time or several at once.
 * The server checks ownership and what may be deleted on every action.
 */
export function SessionLibrary({ sessions }: { sessions: LibrarySession[] }) {
  const router = useRouter();
  const [q, setQ] = useState("");
  const [kind, setKind] = useState<SessionKind | "ALL">("ALL");
  const [scope, setScope] = useState<NonNullable<LibraryQuery["scope"]>>("active");
  const [sort, setSort] = useState<NonNullable<LibraryQuery["sort"]>>("updated");
  const [pending, start] = useTransition();
  const [rename, setRename] = useState<{ s: LibrarySession; name: string } | null>(null);
  const [archive, setArchive] = useState<LibrarySession | null>(null);
  const [del, setDel] = useState<{ s: LibrarySession; impact: Impact | null } | null>(null);
  const [bulk, setBulk] = useState<"delete" | "archive" | "restore" | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  /** Removed on the server: hidden at once, before the refreshed list arrives. */
  const [gone, setGone] = useState<Set<string>>(new Set());
  /** One request per action at a time (double clicks / Enter repeat). */
  const inFlight = useRef(false);

  const visible = useMemo(() => sessions.filter((s) => !gone.has(keyOf(s))), [sessions, gone]);
  const list = useMemo(() => applyLibraryQuery(visible, { q, kind, scope, sort }), [visible, q, kind, scope, sort]);
  const archivedCount = visible.filter((s) => s.archived).length;
  const activeCount = visible.length - archivedCount;
  const chosen = list.filter((s) => selected.has(keyOf(s)));
  const allChosen = list.length > 0 && chosen.length === list.length;

  const act = (fn: () => Promise<{ success: boolean; error?: string; gone?: true }>, ok: string, after?: (ok: boolean) => void) => {
    if (inFlight.current) return;
    inFlight.current = true;
    start(async () => {
      try {
        const res = await fn();
        if (!res.success && !res.gone) return void toast.error(res.error ?? "Something went wrong."); // nothing changed: the row stays
        if (res.success) toast.success(ok);
        else toast.message(res.error ?? "Already deleted."); // e.g. deleted from another tab: drop the row
        after?.(true);
        router.refresh();
      } finally {
        inFlight.current = false;
      }
    });
  };
  const hide = (keys: string[]) => {
    setGone((g) => new Set([...g, ...keys]));
    setSelected((sel) => new Set([...sel].filter((k) => !keys.includes(k))));
  };
  const toggle = (s: LibrarySession) => setSelected((sel) => (sel.has(keyOf(s)) ? new Set([...sel].filter((k) => k !== keyOf(s))) : new Set([...sel, keyOf(s)])));

  const openDelete = async (s: LibrarySession) => {
    setDel({ s, impact: null });
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
            <button
              key={v}
              role="tab"
              type="button"
              aria-selected={scope === v}
              onClick={() => {
                setScope(v);
                setSelected(new Set());
              }}
              className={cn("rounded-[5px] px-2.5 py-1 text-xs", scope === v ? "bg-foreground text-background" : "text-muted-foreground hover:text-foreground")}
            >
              {v === "active" ? `Active (${activeCount})` : v === "archived" ? `Archived (${archivedCount})` : "All"}
            </button>
          ))}
        </div>
      </div>

      {chosen.length > 0 && (
        <div role="region" aria-label="Selection" className="flex flex-wrap items-center gap-2 rounded-lg border border-border bg-muted/40 px-3 py-2 text-sm">
          <span className="font-medium">{chosen.length} selected</span>
          <span className="flex-1" />
          {chosen.some((s) => !s.archived) && (
            <Button size="sm" variant="outline" onClick={() => setBulk("archive")} disabled={pending}>
              <Archive /> Archive
            </Button>
          )}
          {chosen.some((s) => s.archived) && (
            <Button size="sm" variant="outline" onClick={() => setBulk("restore")} disabled={pending}>
              <ArchiveRestore /> Restore
            </Button>
          )}
          <Button size="sm" variant="destructive" onClick={() => setBulk("delete")} disabled={pending}>
            <Trash2 /> Delete
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setSelected(new Set())} aria-label="Clear selection">
            <X />
          </Button>
        </div>
      )}

      {list.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border px-4 py-12 text-center text-sm text-muted-foreground">
          {visible.length === 0 ? (
            <>
              No backtesting sessions yet. Start one in <Link href="/backtesting/lab" className="underline">Strategy Lab</Link> or the <Link href="/backtesting/prop" className="underline">Prop Firm Simulator</Link>.
            </>
          ) : scope === "archived" ? (
            "Nothing archived. Archived sessions keep all their data and can be restored at any time."
          ) : (
            "No sessions match."
          )}
        </div>
      ) : (
        <div className="overflow-hidden rounded-lg border border-border bg-card">
          <div className="flex items-center gap-3 border-b border-border px-4 py-2 text-[11px] uppercase tracking-wide text-muted-foreground">
            <input type="checkbox" aria-label={allChosen ? "Unselect all" : "Select all shown"} checked={allChosen} onChange={() => setSelected(allChosen ? new Set() : new Set(list.map(keyOf)))} className="size-3.5" />
            <span className="flex-1">Session</span>
            <span className="hidden w-40 sm:block">Result</span>
            <span className="hidden w-24 md:block">Updated</span>
            <span className="w-16" />
          </div>
          <ul aria-label="Sessions" className="divide-y divide-border">
            {list.map((s) => {
              const perf = s.performance;
              return (
                <li key={keyOf(s)} className={cn("flex items-center gap-3 px-4 py-3", s.archived && "bg-muted/20")}>
                  <input type="checkbox" aria-label={`Select ${s.name}`} checked={selected.has(keyOf(s))} onChange={() => toggle(s)} className="size-3.5 shrink-0" />
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                      <Link href={s.href} className="truncate font-medium hover:underline">{s.name}</Link>
                      <span className="shrink-0 rounded border border-border px-1.5 py-px text-[10px] uppercase tracking-wide text-muted-foreground">{KIND_LABEL[s.kind]}</span>
                      <span className="shrink-0 text-[11px] text-muted-foreground">{s.status.charAt(0) + s.status.slice(1).toLowerCase()}</span>
                      {s.archived && <span className="shrink-0 rounded bg-muted px-1.5 py-px text-[10px] uppercase tracking-wide text-muted-foreground">Archived</span>}
                    </div>
                    <p className="truncate text-xs text-muted-foreground">
                      {s.assets.join(", ")} · {s.periodStart} → {s.periodEnd}
                      {s.clock && <> · at <span className="font-mono">{s.clock.replace("T", " ")}</span></>}
                      {" · "}created {fmtDate(s.createdAt)}
                    </p>
                  </div>
                  <div className="hidden w-40 text-xs sm:block">
                    {perf ? (
                      <>
                        <span className={cn("font-mono font-medium tabular-nums", perf.netResult > 0 ? "text-emerald-500" : perf.netResult < 0 ? "text-red-400" : "text-muted-foreground")}>{money(perf.netResult, perf.currency)}</span>
                        <span className="block text-muted-foreground">
                          {perf.closedTrades} trade{perf.closedTrades === 1 ? "" : "s"}
                          {perf.closedTrades > 0 && ` · ${Math.round((perf.wins / perf.closedTrades) * 100)}% win`}
                          {perf.openPositions > 0 && ` · ${perf.openPositions} open`}
                        </span>
                      </>
                    ) : (
                      <span className="text-muted-foreground">{s.counts.trades} journaled trade{s.counts.trades === 1 ? "" : "s"}</span>
                    )}
                  </div>
                  <span className="hidden w-24 text-xs text-muted-foreground md:block" title={`Last modified ${new Date(s.updatedAt).toLocaleString()}`}>{fmtDate(s.updatedAt)}</span>
                  <Button variant="ghost" size="icon-sm" onClick={() => void openDelete(s)} disabled={pending} aria-label={`Delete ${s.name}`} title="Delete permanently" className="text-muted-foreground hover:bg-red-500/10 hover:text-red-500">
                    <Trash2 />
                  </Button>
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
                        <DropdownMenuItem onClick={() => act(() => duplicateSessionAction({ kind: s.kind, id: s.id }), "Duplicated — a fresh copy with the same data and settings.")}>
                          <Copy /> Duplicate
                        </DropdownMenuItem>
                      )}
                      {s.archived ? (
                        <DropdownMenuItem onClick={() => act(() => setSessionArchivedAction({ kind: s.kind, id: s.id, archived: false }), "Restored.")}>
                          <ArchiveRestore /> Restore
                        </DropdownMenuItem>
                      ) : (
                        <DropdownMenuItem onClick={() => setArchive(s)}>
                          <Archive /> Archive
                        </DropdownMenuItem>
                      )}
                      <DropdownMenuSeparator />
                      <DropdownMenuItem variant="destructive" onClick={() => void openDelete(s)}>
                        <Trash2 /> Delete permanently
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </li>
              );
            })}
          </ul>
        </div>
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
              if (rename) act(() => renameSessionAction({ kind: rename.s.kind, id: rename.s.id, name: rename.name }), "Renamed.", () => setRename(null));
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
        onConfirm={() => archive && act(() => setSessionArchivedAction({ kind: archive.kind, id: archive.id, archived: true }), "Archived. Find it under Archived.", () => setArchive(null))}
      />

      {/* Single delete. Cancel has focus, so Enter / a stray click never deletes. */}
      <Dialog open={del != null} onOpenChange={(o) => !o && !pending && setDel(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Delete Backtesting Session?</DialogTitle>
            <DialogDescription>
              Are you sure you want to permanently delete <span className="font-semibold text-foreground">“{del?.s.name}”</span>? This action will remove the session and its associated data. This cannot be undone.
            </DialogDescription>
          </DialogHeader>
          {!del?.impact ? (
            <p className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="size-4 animate-spin" /> Checking what it holds…</p>
          ) : !del.impact.allowed ? (
            <p className="text-sm text-amber-500">{del.impact.note}</p>
          ) : (
            <div className="space-y-2 rounded-md border border-border bg-muted/30 p-3 text-sm">
              {del.impact.note && <p className="font-medium text-amber-500">{del.impact.note}</p>}
              <p className="font-medium">Deleted with it:</p>
              <ul className="list-inside list-disc text-muted-foreground">
                <li>{del.impact.trades} {del.s.kind === "LEGACY" ? "journaled trade" : "trade"}{del.impact.trades === 1 ? "" : "s"}{del.s.kind !== "LEGACY" && <>, {del.impact.orders} order{del.impact.orders === 1 ? "" : "s"}, their fills and the account ledger</>}</li>
                <li>{del.impact.drawings} chart drawing{del.impact.drawings === 1 ? "" : "s"}</li>
                {del.s.kind === "LEGACY" ? <li>its days, notes, analyses and screenshots</li> : <li>its replay position and history</li>}
              </ul>
              {del.impact.observations > 0 && <p className="text-xs text-muted-foreground">Kept: {del.impact.observations} study observation{del.impact.observations === 1 ? "" : "s"} recorded here stay in their study (without the link to this session). Your datasets and live accounts aren&apos;t touched.</p>}
            </div>
          )}
          <DialogFooter>
            <Button type="button" variant="outline" autoFocus onClick={() => setDel(null)} disabled={pending}>Cancel</Button>
            <Button
              type="button"
              variant="destructive"
              disabled={pending || !del?.impact?.allowed}
              onClick={() => {
                if (!del) return;
                const k = keyOf(del.s);
                act(() => deleteSessionAction({ kind: del.s.kind, id: del.s.id, confirm: true }), `Deleted “${del.s.name}”.`, () => {
                  hide([k]);
                  setDel(null);
                });
              }}
            >
              {pending ? <Loader2 className="animate-spin" /> : <Trash2 />}Delete permanently
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Bulk confirmations. */}
      <Dialog open={bulk != null} onOpenChange={(o) => !o && !pending && setBulk(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>
              {bulk === "delete" ? `Delete ${chosen.length} Backtesting session${chosen.length === 1 ? "" : "s"}?` : bulk === "archive" ? `Archive ${chosen.filter((s) => !s.archived).length} session${chosen.filter((s) => !s.archived).length === 1 ? "" : "s"}?` : `Restore ${chosen.filter((s) => s.archived).length} session${chosen.filter((s) => s.archived).length === 1 ? "" : "s"}?`}
            </DialogTitle>
            <DialogDescription>
              {bulk === "delete"
                ? `These sessions and their associated data will be permanently deleted.${chosen.some((s) => s.kind === "PROP") ? " Prop Firm sessions take their whole challenge (every phase) with them." : ""} This cannot be undone.`
                : bulk === "archive"
                  ? "They leave your active list; all their data is kept and you can restore them at any time."
                  : "They return to your active list exactly as they were."}
            </DialogDescription>
          </DialogHeader>
          <ul className="max-h-40 space-y-0.5 overflow-y-auto rounded-md border border-border bg-muted/30 p-2 text-sm">
            {(bulk === "archive" ? chosen.filter((s) => !s.archived) : bulk === "restore" ? chosen.filter((s) => s.archived) : chosen).map((s) => (
              <li key={keyOf(s)} className="flex justify-between gap-2">
                <span className="truncate">{s.name}</span>
                <span className="shrink-0 text-xs text-muted-foreground">{s.counts.trades} trade{s.counts.trades === 1 ? "" : "s"}</span>
              </li>
            ))}
          </ul>
          <DialogFooter>
            <Button type="button" variant="outline" autoFocus onClick={() => setBulk(null)} disabled={pending}>Cancel</Button>
            <Button
              type="button"
              variant={bulk === "delete" ? "destructive" : "default"}
              disabled={pending}
              onClick={() => {
                const target = bulk === "archive" ? chosen.filter((s) => !s.archived) : bulk === "restore" ? chosen.filter((s) => s.archived) : chosen;
                const refs = target.map((s) => ({ kind: s.kind, id: s.id }));
                if (bulk === "delete")
                  act(() => bulkDeleteSessionsAction({ refs, confirm: true }), `Deleted ${refs.length} session${refs.length === 1 ? "" : "s"}.`, () => {
                    hide(target.map(keyOf));
                    setBulk(null);
                  });
                else
                  act(() => bulkArchiveSessionsAction({ refs, archived: bulk === "archive" }), bulk === "archive" ? `Archived ${refs.length}.` : `Restored ${refs.length}.`, () => {
                    setSelected(new Set());
                    setBulk(null);
                  });
              }}
            >
              {pending && <Loader2 className="animate-spin" />}
              {bulk === "delete" ? "Delete permanently" : bulk === "archive" ? "Archive" : "Restore"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
