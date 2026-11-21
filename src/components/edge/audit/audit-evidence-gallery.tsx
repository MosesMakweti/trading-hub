"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ImagePlus, Loader2, MapPin, PenLine, Trash2, X, ZoomIn, ZoomOut } from "lucide-react";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import { ensureUploadOwnerAction, removeAuditImageAction, saveAnnotationAction } from "@/actions/trade-audit.actions";
import { ACCEPTED_IMAGE_MIME, MAX_FILE_SIZE } from "@/lib/media-constants";
import { ANNOTATION_KIND_LABEL } from "@/domain/trade-audit/labels";
import { ANNOTATION_KINDS, type AnnotationKind, type AnnotationMarker, type AuditImageDTO, type ImageProvenance } from "@/types/trade-audit";
import { newClientKey, useAudit } from "@/components/edge/audit/audit-context";

const PROVENANCE: Record<ImageProvenance, { label: string; className: string; title: string }> = {
  SESSION: {
    label: "Captured during session",
    className: "bg-success/15 text-success border-success/30",
    title: "Attached to the trade record on or before its trading day.",
  },
  POST_SESSION: {
    label: "Added after session",
    className: "bg-warning/15 text-warning-foreground border-warning/40 dark:text-warning",
    title: "Attached to the trade record after its trading day ended.",
  },
  REVIEW: {
    label: "Uploaded in review",
    className: "bg-primary/10 text-primary border-primary/30",
    title: "Added during this weekly review — retrospective evidence.",
  },
};

export function ProvenanceBadge({ provenance, annotated }: { provenance: ImageProvenance; annotated?: boolean }) {
  const p = PROVENANCE[provenance];
  return (
    <span className="inline-flex flex-wrap gap-1">
      <span title={p.title} className={cn("rounded border px-1.5 py-px text-[10px] font-medium leading-tight", p.className)}>
        {p.label}
      </span>
      {annotated && (
        <span title="Markers drawn during this review — not part of the original screenshot." className="rounded border border-violet-500/40 bg-violet-500/10 px-1.5 py-px text-[10px] font-medium leading-tight text-violet-600 dark:text-violet-300">
          Annotated in review
        </span>
      )}
    </span>
  );
}

/** Which review row a new upload attaches to — resolved (created) server-side. */
export type UploadTarget = { kind: "ASSESSMENT"; tradeId: string } | { kind: "DAY"; dateKey: string } | { kind: "EXPECTED"; expectedId: string };

/**
 * Screenshots for one trade / opportunity / day: thumbnails with provenance
 * badges, a zoomable viewer with retrospective markers, and (when `upload` is
 * given and the week is open) upload + remove for review screenshots. Original
 * trade screenshots are never removable from here.
 */
export function AuditEvidenceGallery({
  images,
  upload,
  category,
  emptyLabel,
  compact = false,
}: {
  images: AuditImageDTO[];
  upload?: UploadTarget;
  category?: string;
  emptyLabel?: string;
  compact?: boolean;
}) {
  const router = useRouter();
  const { scope, locked, uploadsEnabled } = useAudit();
  const [viewing, setViewing] = useState<AuditImageDTO | null>(null);
  const [pendingRemove, setPendingRemove] = useState<AuditImageDTO | null>(null);
  const [uploading, setUploading] = useState(false);
  const [removing, startRemove] = useTransition();
  const inputRef = useRef<HTMLInputElement>(null);
  const canUpload = Boolean(upload) && !locked && uploadsEnabled;

  async function onFiles(list: FileList | null) {
    if (!upload || !list || list.length === 0) return;
    const files = Array.from(list).filter((f) => (ACCEPTED_IMAGE_MIME as readonly string[]).includes(f.type) && f.size <= MAX_FILE_SIZE);
    if (files.length === 0) {
      toast.error("Choose a PNG, JPG, WebP or GIF under 8MB.");
      return;
    }
    setUploading(true);
    try {
      let ownerType: string;
      let ownerId: string;
      if (upload.kind === "EXPECTED") {
        ownerType = "TRADE_AUDIT_EXPECTED";
        ownerId = upload.expectedId;
      } else {
        const owner = await ensureUploadOwnerAction(upload.kind === "ASSESSMENT" ? { kind: "ASSESSMENT", scope, tradeId: upload.tradeId } : { kind: "DAY", scope, dateKey: upload.dateKey });
        if (!owner.success) throw new Error(owner.error);
        ownerType = owner.ownerType;
        ownerId = owner.ownerId;
      }
      const form = new FormData();
      form.set("ownerType", ownerType);
      form.set("ownerId", ownerId);
      if (category) form.set("category", category);
      for (const f of files) form.append("files", f);
      const res = await fetch("/api/media/upload", { method: "POST", body: form });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: string } | null;
        throw new Error(body?.error ?? "Upload failed.");
      }
      toast.success(files.length === 1 ? "Screenshot added." : `${files.length} screenshots added.`);
      router.refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Upload failed.");
    } finally {
      setUploading(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  function remove() {
    const target = pendingRemove;
    if (!target) return;
    startRemove(async () => {
      const result = await removeAuditImageAction(target.attachmentId);
      if (!result.success) toast.error(result.error);
      setPendingRemove(null);
      router.refresh();
    });
  }

  if (images.length === 0 && !canUpload) {
    return emptyLabel ? <p className="text-[11px] text-muted-foreground">{emptyLabel}</p> : null;
  }

  return (
    <div className="space-y-1.5">
      <div className={cn("grid gap-2", compact ? "grid-cols-3 sm:grid-cols-4" : "grid-cols-2 sm:grid-cols-3")}>
        {images.map((img) => (
          <figure key={img.attachmentId} className="group relative overflow-hidden rounded-lg border border-border bg-muted/30">
            <button type="button" className="block w-full" onClick={() => setViewing(img)} aria-label={`Open ${img.fileName}`}>
              <AnnotatedImage image={img} className="aspect-video" thumbnail />
            </button>
            <figcaption className="space-y-0.5 p-1.5">
              <ProvenanceBadge provenance={img.provenance} annotated={(img.annotation?.length ?? 0) > 0} />
              {img.caption && <p className="truncate text-[11px] text-muted-foreground">{img.caption}</p>}
            </figcaption>
            {img.removable && !locked && (
              <Button
                type="button"
                variant="ghost"
                size="icon-xs"
                className="absolute top-1 right-1 bg-background/80 opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100"
                aria-label="Remove screenshot"
                onClick={() => setPendingRemove(img)}
              >
                <Trash2 />
              </Button>
            )}
          </figure>
        ))}
        {canUpload && (
          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            disabled={uploading}
            className="flex aspect-video flex-col items-center justify-center gap-1 rounded-lg border border-dashed border-border text-[11px] text-muted-foreground transition-colors hover:border-primary/50 hover:text-foreground"
          >
            {uploading ? <Loader2 className="size-4 animate-spin" /> : <ImagePlus className="size-4" />}
            {uploading ? "Uploading…" : "Add screenshot"}
          </button>
        )}
      </div>
      {canUpload && <input ref={inputRef} type="file" accept={ACCEPTED_IMAGE_MIME.join(",")} multiple hidden aria-label="Upload review screenshot" onChange={(e) => void onFiles(e.target.files)} />}

      <Dialog open={viewing != null} onOpenChange={(open) => !open && setViewing(null)}>
        {viewing && <EvidenceViewer key={viewing.attachmentId} image={viewing} onSaved={() => router.refresh()} />}
      </Dialog>

      <ConfirmDialog
        open={pendingRemove != null}
        onOpenChange={(open) => !open && setPendingRemove(null)}
        title="Remove screenshot?"
        description="This deletes the review screenshot. Original trade screenshots are not affected."
        confirmLabel="Remove"
        variant="destructive"
        isPending={removing}
        onConfirm={remove}
      />
    </div>
  );
}

/** The image with its markers overlaid (markers are % positions, so they scale with zoom). */
function AnnotatedImage({
  image,
  markers,
  className,
  thumbnail,
  onPlace,
}: {
  image: AuditImageDTO;
  markers?: AnnotationMarker[];
  className?: string;
  thumbnail?: boolean;
  onPlace?: (x: number, y: number) => void;
}) {
  const shown = markers ?? image.annotation ?? [];
  return (
    <div
      className={cn("relative w-full", onPlace && "cursor-crosshair", className)}
      onClick={(e) => {
        if (!onPlace) return;
        const rect = e.currentTarget.getBoundingClientRect();
        onPlace((e.clientX - rect.left) / rect.width, (e.clientY - rect.top) / rect.height);
      }}
    >
      {/* eslint-disable-next-line @next/next/no-img-element -- auth-scoped media route, not a static asset */}
      <img src={image.url} alt={image.caption ?? image.fileName} className={cn("block w-full", thumbnail ? "h-full object-cover" : "h-auto")} draggable={false} />
      {shown.map((m) => {
        const k = ANNOTATION_KIND_LABEL[m.kind];
        return (
          <span
            key={m.id}
            title={`${k.label}${m.note ? ` — ${m.note}` : ""}`}
            className={cn("absolute -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white font-bold text-white shadow", thumbnail ? "size-3" : "px-1.5 py-0.5 text-[10px]")}
            style={{ left: `${m.x * 100}%`, top: `${m.y * 100}%`, backgroundColor: k.color }}
          >
            {thumbnail ? null : k.short}
          </span>
        );
      })}
    </div>
  );
}

function EvidenceViewer({ image, onSaved }: { image: AuditImageDTO; onSaved: () => void }) {
  const { scope, locked } = useAudit();
  const [scale, setScale] = useState(1);
  const [editing, setEditing] = useState(false);
  const [kind, setKind] = useState<AnnotationKind>("INTENDED_ENTRY");
  const [markers, setMarkers] = useState<AnnotationMarker[]>(image.annotation ?? []);
  const [saving, startSave] = useTransition();

  function save() {
    startSave(async () => {
      const result = await saveAnnotationAction({ scope, attachmentId: image.attachmentId, markers });
      if (!result.success) {
        toast.error(result.error);
        return;
      }
      toast.success(markers.length > 0 ? "Markers saved." : "Markers cleared.");
      setEditing(false);
      onSaved();
    });
  }

  return (
    <DialogContent className="max-h-[92vh] w-[min(96vw,1200px)] max-w-none overflow-hidden p-0 sm:max-w-none">
      <div className="flex flex-wrap items-center gap-2 border-b border-border px-4 py-2.5 pr-12">
        <DialogTitle className="text-sm">{image.caption ?? image.fileName}</DialogTitle>
        <ProvenanceBadge provenance={image.provenance} annotated={markers.length > 0} />
        <DialogDescription className="sr-only">Screenshot viewer with zoom and review markers.</DialogDescription>
        <div className="ml-auto flex items-center gap-1">
          <Button type="button" variant="ghost" size="icon-sm" aria-label="Zoom out" onClick={() => setScale((s) => Math.max(1, s - 0.5))} disabled={scale <= 1}>
            <ZoomOut />
          </Button>
          <span className="w-10 text-center text-xs tabular-nums text-muted-foreground">{Math.round(scale * 100)}%</span>
          <Button type="button" variant="ghost" size="icon-sm" aria-label="Zoom in" onClick={() => setScale((s) => Math.min(4, s + 0.5))} disabled={scale >= 4}>
            <ZoomIn />
          </Button>
          {!locked && !editing && (
            <Button type="button" variant="outline" size="sm" className="ml-1 gap-1" onClick={() => setEditing(true)}>
              <PenLine className="size-3.5" /> Mark up
            </Button>
          )}
        </div>
      </div>

      {editing && (
        <div className="flex flex-wrap items-center gap-1.5 border-b border-border bg-muted/30 px-4 py-2">
          <span className="text-xs text-muted-foreground">Click the chart to place:</span>
          {ANNOTATION_KINDS.map((k) => {
            const meta = ANNOTATION_KIND_LABEL[k];
            return (
              <button
                key={k}
                type="button"
                aria-pressed={kind === k}
                onClick={() => setKind(k)}
                className={cn("inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs", kind === k ? "border-foreground/50 bg-background" : "border-transparent text-muted-foreground hover:text-foreground")}
              >
                <span className="size-2.5 rounded-full" style={{ backgroundColor: meta.color }} />
                {meta.label}
              </button>
            );
          })}
          <span className="ml-auto text-[11px] text-muted-foreground">Markers are saved beside the image — the original screenshot is never altered.</span>
        </div>
      )}

      <div className="grid max-h-[calc(92vh-7rem)] grid-cols-1 md:grid-cols-[1fr_260px]">
        <div className="overflow-auto bg-black/80 p-2">
          <div style={{ width: `${scale * 100}%` }} className="mx-auto">
            <AnnotatedImage
              image={image}
              markers={markers}
              onPlace={editing ? (x, y) => setMarkers((m) => [...m, { id: newClientKey(), kind, x: Math.min(1, Math.max(0, x)), y: Math.min(1, Math.max(0, y)), note: null }]) : undefined}
            />
          </div>
        </div>
        {(markers.length > 0 || editing) && (
          <aside className="space-y-2 overflow-y-auto border-t border-border p-3 md:border-t-0 md:border-l">
            <p className="flex items-center gap-1 text-xs font-medium">
              <MapPin className="size-3.5" /> Review markers
            </p>
            <p className="text-[11px] text-muted-foreground">Retrospective — drawn during this review, not at the time of the trade.</p>
            {markers.length === 0 && <p className="text-xs text-muted-foreground">No markers yet.</p>}
            <ul className="space-y-1.5">
              {markers.map((m) => {
                const meta = ANNOTATION_KIND_LABEL[m.kind];
                return (
                  <li key={m.id} className="space-y-1 rounded-md border border-border p-1.5">
                    <div className="flex items-center gap-1.5 text-xs">
                      <span className="rounded px-1 text-[10px] font-bold text-white" style={{ backgroundColor: meta.color }}>
                        {meta.short}
                      </span>
                      {meta.label}
                      {editing && (
                        <button type="button" className="ml-auto text-muted-foreground hover:text-danger" aria-label={`Remove ${meta.label} marker`} onClick={() => setMarkers((all) => all.filter((x) => x.id !== m.id))}>
                          <X className="size-3.5" />
                        </button>
                      )}
                    </div>
                    {editing ? (
                      <input
                        className="w-full rounded border border-input bg-transparent px-1.5 py-0.5 text-xs"
                        placeholder="Note (optional)"
                        maxLength={300}
                        value={m.note ?? ""}
                        onChange={(e) => setMarkers((all) => all.map((x) => (x.id === m.id ? { ...x, note: e.target.value || null } : x)))}
                      />
                    ) : (
                      m.note && <p className="text-[11px] text-muted-foreground">{m.note}</p>
                    )}
                  </li>
                );
              })}
            </ul>
            {editing && (
              <div className="flex gap-1.5 pt-1">
                <Button type="button" size="sm" onClick={save} disabled={saving}>
                  {saving && <Loader2 className="size-3.5 animate-spin" />} Save markers
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  onClick={() => {
                    setMarkers(image.annotation ?? []);
                    setEditing(false);
                  }}
                >
                  Cancel
                </Button>
              </div>
            )}
          </aside>
        )}
      </div>
    </DialogContent>
  );
}
