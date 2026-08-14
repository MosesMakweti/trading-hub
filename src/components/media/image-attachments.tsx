"use client";

import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { ImageOff, Loader2, RotateCcw, Trash2, UploadCloud, XIcon, ZoomIn, ZoomOut } from "lucide-react";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import { deleteMediaAction, loadMediaAction } from "@/actions/media.actions";
import type { MediaItemDTO } from "@/server/services/media.service";
import type { MediaOwnerType } from "@prisma/client";

const DEFAULT_MAX = 12;
const MIN_ZOOM = 1;
const MAX_ZOOM = 4;
const ZOOM_STEP = 0.5;
const DOUBLE_CLICK_ZOOM = 2.5;

interface Point {
  x: number;
  y: number;
}

/**
 * ImageAttachments — the universal, reusable image uploader for TradeOS. Drop it
 * anywhere with `ownerType` + `ownerId` (and an optional `category`) and it manages
 * the whole lifecycle: click-to-upload AND drag-and-drop, live progress, compact
 * glass thumbnails, full-size zoom, and delete. It self-fetches its list on mount
 * (so wiring is a one-liner), or accepts `initial`/`uploadsEnabled` to skip the
 * fetch when the server already has the data. Uploads POST straight to the
 * app's own /api/media/upload route (local filesystem backend), which enforces
 * auth, ownership, and server-side MIME/size validation before any file is saved.
 */
export function ImageAttachments({
  ownerType,
  ownerId,
  category,
  label,
  max = DEFAULT_MAX,
  disabled = false,
  initial,
  uploadsEnabled: uploadsEnabledProp,
  className,
}: {
  ownerType: MediaOwnerType;
  ownerId: string;
  category?: string;
  label?: string;
  max?: number;
  /** Read-only (e.g. an archived day): thumbnails + zoom stay, upload/delete hide. */
  disabled?: boolean;
  initial?: MediaItemDTO[];
  uploadsEnabled?: boolean;
  className?: string;
}) {
  const [items, setItems] = useState<MediaItemDTO[]>(initial ?? []);
  const [uploadsEnabled, setUploadsEnabled] = useState(uploadsEnabledProp ?? true);
  const [loading, setLoading] = useState(initial === undefined);
  const [progress, setProgress] = useState(0);
  const [dragActive, setDragActive] = useState(false);
  const [zoomed, setZoomed] = useState<MediaItemDTO | null>(null);
  const [pendingDelete, setPendingDelete] = useState<MediaItemDTO | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  // Self-fetch on mount unless the caller supplied `initial`.
  useEffect(() => {
    if (initial !== undefined) return;
    let active = true;
    void (async () => {
      const res = await loadMediaAction(ownerType, ownerId);
      if (!active) return;
      setUploadsEnabled(res.uploadsEnabled);
      setItems(category ? res.items.filter((i) => i.category === category) : res.items);
      setLoading(false);
    })();
    return () => {
      active = false;
    };
  }, [ownerType, ownerId, category, initial]);

  const remaining = max - items.length;
  const canManage = uploadsEnabled && !disabled;
  const canUpload = canManage && remaining > 0 && !isUploading;

  /** POST the files to our own upload route, reporting progress via XHR. */
  function uploadFiles(files: File[]): Promise<MediaItemDTO[]> {
    return new Promise((resolve, reject) => {
      const form = new FormData();
      form.set("ownerType", ownerType);
      form.set("ownerId", ownerId);
      if (category) form.set("category", category);
      for (const file of files) form.append("files", file);

      const xhr = new XMLHttpRequest();
      xhr.open("POST", "/api/media/upload");
      xhr.upload.onprogress = (e) => {
        if (e.lengthComputable) setProgress(Math.round((e.loaded / e.total) * 100));
      };
      xhr.onload = () => {
        if (xhr.status >= 200 && xhr.status < 300) {
          try {
            resolve((JSON.parse(xhr.responseText).items ?? []) as MediaItemDTO[]);
          } catch {
            reject(new Error("Unexpected server response."));
          }
        } else {
          let message = "Upload failed.";
          try {
            message = JSON.parse(xhr.responseText).error ?? message;
          } catch {
            /* keep default */
          }
          reject(new Error(message));
        }
      };
      xhr.onerror = () => reject(new Error("Upload failed."));
      xhr.send(form);
    });
  }

  function beginUpload(files: File[]) {
    const images = files.filter((file) => file.type.startsWith("image/"));
    if (images.length === 0) {
      toast.error("Only image files can be uploaded.");
      return;
    }
    if (images.length < files.length) {
      toast.warning("Skipped non-image files.");
    }
    const picked = images.slice(0, remaining);
    if (images.length > remaining) {
      toast.warning(`Only ${remaining} more image${remaining === 1 ? "" : "s"} allowed here.`);
    }
    if (picked.length === 0) return;

    setIsUploading(true);
    setProgress(0);
    uploadFiles(picked)
      .then((created) => {
        const relevant = category ? created.filter((i) => i.category === category) : created;
        setItems((prev) => [...prev, ...relevant]);
        toast.success(`Image${picked.length === 1 ? "" : "s"} uploaded.`);
      })
      .catch((e: unknown) => {
        toast.error(e instanceof Error ? e.message : "Upload failed.");
      })
      .finally(() => {
        setIsUploading(false);
        setProgress(0);
      });
  }

  function onFilesPicked(fileList: FileList | null) {
    if (!fileList || fileList.length === 0) return;
    beginUpload(Array.from(fileList));
    if (inputRef.current) inputRef.current.value = "";
  }

  function onDrop(e: React.DragEvent) {
    e.preventDefault();
    setDragActive(false);
    if (!canUpload) return;
    beginUpload(Array.from(e.dataTransfer.files));
  }

  async function confirmDelete() {
    if (!pendingDelete) return;
    setIsDeleting(true);
    const result = await deleteMediaAction(pendingDelete.id);
    setIsDeleting(false);
    if (result.success) {
      setItems((prev) => prev.filter((i) => i.id !== pendingDelete.id));
      setPendingDelete(null);
      toast.success("Image deleted.");
    } else {
      toast.error(result.error);
    }
  }

  return (
    <div className={cn("space-y-2", className)}>
      {label && (
        <div className="flex items-center justify-between gap-2">
          <span className="text-xs font-medium text-muted-foreground">{label}</span>
          {canManage && (
            <span className="text-xs text-muted-foreground/70 tabular-nums">
              {items.length}/{max}
            </span>
          )}
        </div>
      )}

      {/* Thumbnail grid — compact, glass, responsive. */}
      {items.length > 0 && (
        <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
          {items.map((img) => (
            <div key={img.id} className="group/img relative">
              <button
                type="button"
                onClick={() => setZoomed(img)}
                className="glass block w-full overflow-hidden rounded-lg focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
                aria-label={`View ${img.fileName}`}
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={img.url}
                  alt={img.fileName}
                  className="aspect-video w-full object-cover transition-transform group-hover/img:scale-[1.03]"
                />
                <span className="pointer-events-none absolute inset-0 flex items-center justify-center bg-black/0 opacity-0 transition-opacity group-hover/img:bg-black/30 group-hover/img:opacity-100">
                  <ZoomIn className="size-4 text-white" />
                </span>
              </button>
              {canManage && (
                <Button
                  type="button"
                  variant="destructive"
                  size="icon-xs"
                  aria-label={`Delete ${img.fileName}`}
                  className="absolute top-1 right-1 opacity-0 transition-opacity group-hover/img:opacity-100 focus-visible:opacity-100"
                  onClick={() => setPendingDelete(img)}
                >
                  <Trash2 />
                </Button>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Drop zone / click-to-upload. */}
      {canManage && (
        <>
          <input
            ref={inputRef}
            type="file"
            accept="image/*"
            multiple
            className="hidden"
            onChange={(e) => onFilesPicked(e.target.files)}
          />
          <button
            type="button"
            disabled={!canUpload}
            onClick={() => inputRef.current?.click()}
            onDragOver={(e) => {
              e.preventDefault();
              if (canUpload) setDragActive(true);
            }}
            onDragLeave={() => setDragActive(false)}
            onDrop={onDrop}
            className={cn(
              "glass flex w-full flex-col items-center justify-center gap-1.5 rounded-lg border border-dashed px-3 py-4 text-center transition-colors",
              dragActive ? "border-primary/60 bg-accent/40" : "border-border",
              !canUpload && "cursor-not-allowed opacity-60",
            )}
          >
            {isUploading ? (
              <>
                <Loader2 className="size-4 animate-spin text-muted-foreground" />
                <span className="text-xs text-muted-foreground tabular-nums">
                  Uploading… {progress}%
                </span>
                <span className="h-1 w-full max-w-[160px] overflow-hidden rounded-full bg-muted">
                  <span
                    className="block h-full rounded-full bg-primary transition-[width] duration-200"
                    style={{ width: `${progress}%` }}
                  />
                </span>
              </>
            ) : remaining > 0 ? (
              <>
                <UploadCloud className="size-4 text-muted-foreground" />
                <span className="text-xs text-muted-foreground">
                  Drop images or <span className="text-primary">click to upload</span>
                </span>
              </>
            ) : (
              <span className="text-xs text-muted-foreground">Limit reached ({max})</span>
            )}
          </button>
        </>
      )}

      {!loading && items.length === 0 && !canManage && (
        <p className="flex items-center gap-1.5 text-xs text-muted-foreground/60 italic">
          <ImageOff className="size-3.5" />
          {uploadsEnabled ? "No images." : "Image hosting isn't configured."}
        </p>
      )}

      {/* Full-size, zoomable lightbox. Keyed by image id so switching images (or
          closing) remounts it — zoom/pan state resets for free, no effect needed. */}
      <Dialog open={zoomed != null} onOpenChange={(open) => !open && setZoomed(null)}>
        {zoomed && <ImageLightbox key={zoomed.id} item={zoomed} />}
      </Dialog>

      <ConfirmDialog
        open={pendingDelete != null}
        onOpenChange={(open) => !open && setPendingDelete(null)}
        title="Delete image?"
        description="This permanently removes the image from this item and from storage."
        confirmLabel="Delete"
        variant="destructive"
        isPending={isDeleting}
        onConfirm={confirmDelete}
      />
    </div>
  );
}

/**
 * Near-full-viewport, zoomable/pannable image preview. `scale` is the only
 * source of truth for "how zoomed in"; `pan` is a screen-pixel offset from
 * center. Both live purely as CSS transforms (no library) — mouse wheel and
 * double-click zoom anchored at the cursor, drag-to-pan once zoomed past 1x.
 */
function ImageLightbox({ item }: { item: MediaItemDTO }) {
  const [scale, setScale] = useState(1);
  const [pan, setPan] = useState<Point>({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState(false);
  const dragRef = useRef<{ startX: number; startY: number; startPan: Point } | null>(null);

  /** Zoom to `nextScale`, keeping the point under `anchor` (relative to the
   *  viewport's center) visually fixed. */
  function zoomTo(nextScale: number, anchor: Point) {
    const clamped = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, nextScale));
    if (clamped === scale) return;
    if (clamped === MIN_ZOOM) {
      setScale(MIN_ZOOM);
      setPan({ x: 0, y: 0 });
      return;
    }
    const localX = (anchor.x - pan.x) / scale;
    const localY = (anchor.y - pan.y) / scale;
    setPan({ x: anchor.x - localX * clamped, y: anchor.y - localY * clamped });
    setScale(clamped);
  }

  function anchorFromEvent(e: { clientX: number; clientY: number; currentTarget: EventTarget }) {
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    return { x: e.clientX - rect.left - rect.width / 2, y: e.clientY - rect.top - rect.height / 2 };
  }

  function handleWheel(e: React.WheelEvent<HTMLDivElement>) {
    e.preventDefault();
    const direction = e.deltaY < 0 ? 1 : -1;
    zoomTo(scale + direction * ZOOM_STEP, anchorFromEvent(e));
  }

  function handleDoubleClick(e: React.MouseEvent<HTMLDivElement>) {
    zoomTo(scale > MIN_ZOOM ? MIN_ZOOM : DOUBLE_CLICK_ZOOM, anchorFromEvent(e));
  }

  function handlePointerDown(e: React.PointerEvent<HTMLDivElement>) {
    if (scale <= MIN_ZOOM) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    dragRef.current = { startX: e.clientX, startY: e.clientY, startPan: pan };
    setIsDragging(true);
  }

  function handlePointerMove(e: React.PointerEvent<HTMLDivElement>) {
    if (!dragRef.current) return;
    const { startX, startY, startPan } = dragRef.current;
    setPan({ x: startPan.x + (e.clientX - startX), y: startPan.y + (e.clientY - startY) });
  }

  function endDrag(e: React.PointerEvent<HTMLDivElement>) {
    if (dragRef.current && e.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId);
    }
    dragRef.current = null;
    setIsDragging(false);
  }

  const zoomedIn = scale > MIN_ZOOM;

  return (
    <DialogContent
      showCloseButton={false}
      className="flex h-[92vh] max-h-[92vh] w-[96vw] max-w-[96vw] flex-col gap-0 overflow-hidden bg-popover/95 p-0 sm:max-w-[96vw]"
    >
      <DialogTitle className="sr-only">{item.fileName}</DialogTitle>
      <DialogDescription className="sr-only">
        Full-size view of the attachment. Scroll or double-click to zoom, drag to pan once zoomed.
      </DialogDescription>

      <div className="flex shrink-0 items-center justify-between gap-2 border-b border-border px-3 py-2">
        <span className="truncate text-xs text-muted-foreground">{item.fileName}</span>
        <div className="flex items-center gap-1">
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label="Zoom out"
            disabled={scale <= MIN_ZOOM}
            onClick={() => zoomTo(scale - ZOOM_STEP, { x: 0, y: 0 })}
          >
            <ZoomOut />
          </Button>
          <span className="w-10 text-center text-xs text-muted-foreground tabular-nums">
            {Math.round(scale * 100)}%
          </span>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label="Zoom in"
            disabled={scale >= MAX_ZOOM}
            onClick={() => zoomTo(scale + ZOOM_STEP, { x: 0, y: 0 })}
          >
            <ZoomIn />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label="Reset zoom"
            disabled={!zoomedIn}
            onClick={() => {
              setScale(MIN_ZOOM);
              setPan({ x: 0, y: 0 });
            }}
          >
            <RotateCcw />
          </Button>
          <DialogClose render={<Button type="button" variant="ghost" size="icon-sm" aria-label="Close" />}>
            <XIcon />
          </DialogClose>
        </div>
      </div>

      <div
        className="relative min-h-0 flex-1 touch-none overflow-hidden select-none"
        onWheel={handleWheel}
        onDoubleClick={handleDoubleClick}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={item.url}
          alt={item.fileName}
          draggable={false}
          className={cn(
            "absolute top-1/2 left-1/2 max-h-full max-w-full object-contain",
            zoomedIn ? (isDragging ? "cursor-grabbing" : "cursor-grab") : "cursor-zoom-in",
          )}
          style={{
            transform: `translate(calc(-50% + ${pan.x}px), calc(-50% + ${pan.y}px)) scale(${scale})`,
            transition: isDragging ? "none" : "transform 150ms ease-out",
          }}
        />
      </div>
    </DialogContent>
  );
}
