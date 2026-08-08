"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { ImageOff, Loader2, Trash2, UploadCloud, ZoomIn } from "lucide-react";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import { useUploadThing } from "@/lib/uploadthing";
import { deleteMediaAction, loadMediaAction } from "@/actions/media.actions";
import type { MediaItemDTO } from "@/server/services/media.service";
import type { MediaOwnerType } from "@prisma/client";

const DEFAULT_MAX = 12;

/**
 * ImageAttachments — the universal, reusable image uploader for TradeOS. Drop it
 * anywhere with `ownerType` + `ownerId` (and an optional `category`) and it manages
 * the whole lifecycle: click-to-upload AND drag-and-drop, live progress, compact
 * glass thumbnails, full-size zoom, and delete. It self-fetches its list on mount
 * (so wiring is a one-liner), or accepts `initial`/`uploadsEnabled` to skip the
 * fetch when the server already has the data. Uploads stream straight to
 * UploadThing via the shared FileRouter, which enforces auth, ownership, and
 * server-side MIME/size validation before any file reaches storage.
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
  const inputRef = useRef<HTMLInputElement>(null);

  const refresh = useCallback(async () => {
    const res = await loadMediaAction(ownerType, ownerId);
    setUploadsEnabled(res.uploadsEnabled);
    setItems(category ? res.items.filter((i) => i.category === category) : res.items);
  }, [ownerType, ownerId, category]);

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

  const { startUpload, isUploading } = useUploadThing("media", {
    onUploadProgress: (p) => setProgress(p),
    onClientUploadComplete: () => {
      setProgress(0);
      void refresh();
      toast.success("Image uploaded.");
    },
    onUploadError: (e) => {
      setProgress(0);
      toast.error(e.message || "Upload failed.");
    },
  });

  const remaining = max - items.length;
  const canManage = uploadsEnabled && !disabled;
  const canUpload = canManage && remaining > 0 && !isUploading;

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
    void startUpload(picked, { ownerType, ownerId, category });
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

      {/* Full-size zoom. */}
      <Dialog open={zoomed != null} onOpenChange={(open) => !open && setZoomed(null)}>
        <DialogContent className="max-w-3xl">
          <DialogTitle className="sr-only">{zoomed?.fileName ?? "Image"}</DialogTitle>
          <DialogDescription className="sr-only">Full-size view of the attachment.</DialogDescription>
          {zoomed && (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={zoomed.url}
              alt={zoomed.fileName}
              className="max-h-[80vh] w-full rounded-lg object-contain"
            />
          )}
        </DialogContent>
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
