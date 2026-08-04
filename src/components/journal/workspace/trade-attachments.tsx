"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ImageOff, Loader2, Plus, Trash2, ZoomIn } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import { useWorkspaceEditable } from "@/components/journal/workspace/editable-context";
import { useUploadThing } from "@/lib/uploadthing";
import { deleteTradeImageAction } from "@/actions/trade-images.actions";
import type { TradeWorkspaceDTO, TradeWorkspaceImageDTO } from "@/types/trades";

const MAX_PER_CATEGORY = 6;

const CATEGORIES: { key: TradeWorkspaceImageDTO["category"]; label: string }[] = [
  { key: "ANALYSIS", label: "Analysis charts" },
  { key: "BEFORE", label: "Before trade" },
  { key: "AFTER", label: "After trade" },
];

export function TradeAttachments({
  trade,
  uploadsEnabled,
}: {
  trade: TradeWorkspaceDTO;
  uploadsEnabled: boolean;
}) {
  const editable = useWorkspaceEditable();
  const [zoomed, setZoomed] = useState<TradeWorkspaceImageDTO | null>(null);
  // Managing (upload/delete) needs both hosting configured AND an editable day;
  // the "not configured" note below stays keyed to hosting alone.
  const canManage = uploadsEnabled && editable;

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        {CATEGORIES.map((cat) => (
          <CategoryCard
            key={cat.key}
            label={cat.label}
            category={cat.key}
            dateKey={trade.dateKey}
            tradeId={trade.id}
            images={trade.images.filter((i) => i.category === cat.key)}
            uploadsEnabled={canManage}
            onZoom={setZoomed}
          />
        ))}
      </div>

      {!uploadsEnabled && (
        <p className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
          <ImageOff className="size-3.5" />
          Image hosting isn&apos;t configured, so uploads are disabled. Existing screenshots still
          display.
        </p>
      )}

      <Dialog open={zoomed != null} onOpenChange={(open) => !open && setZoomed(null)}>
        <DialogContent className="max-w-3xl">
          <DialogTitle className="sr-only">Trade screenshot</DialogTitle>
          <DialogDescription className="sr-only">
            Full-size view of the selected trade screenshot.
          </DialogDescription>
          {zoomed && (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={zoomed.url}
              alt="Trade screenshot"
              className="max-h-[80vh] w-full rounded-lg object-contain"
            />
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

function CategoryCard({
  label,
  category,
  dateKey,
  tradeId,
  images,
  uploadsEnabled,
  onZoom,
}: {
  label: string;
  category: TradeWorkspaceImageDTO["category"];
  dateKey: string;
  tradeId: string;
  images: TradeWorkspaceImageDTO[];
  uploadsEnabled: boolean;
  onZoom: (img: TradeWorkspaceImageDTO) => void;
}) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [pendingDelete, setPendingDelete] = useState<TradeWorkspaceImageDTO | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

  const { startUpload, isUploading } = useUploadThing("tradeImage", {
    onClientUploadComplete: () => {
      toast.success("Image uploaded.");
      router.refresh();
    },
    onUploadError: (e) => {
      toast.error(e.message || "Upload failed.");
    },
  });

  const remaining = MAX_PER_CATEGORY - images.length;
  const canUpload = uploadsEnabled && remaining > 0 && !isUploading;

  function onFilesPicked(files: FileList | null) {
    if (!files || files.length === 0) return;
    const picked = Array.from(files).slice(0, remaining);
    if (files.length > remaining) {
      toast.warning(`Only ${remaining} more image${remaining === 1 ? "" : "s"} allowed here.`);
    }
    void startUpload(picked, { tradeId, category });
    if (inputRef.current) inputRef.current.value = "";
  }

  async function confirmDelete() {
    if (!pendingDelete) return;
    setIsDeleting(true);
    const result = await deleteTradeImageAction(dateKey, pendingDelete.id);
    setIsDeleting(false);
    if (result.success) {
      toast.success("Image deleted.");
      setPendingDelete(null);
      router.refresh();
    } else {
      toast.error(result.error);
    }
  }

  return (
    <div className="rounded-xl border border-border bg-background/40 p-3">
      <div className="mb-2 flex items-center justify-between gap-2">
        <span className="text-xs font-medium text-muted-foreground">{label}</span>
        {uploadsEnabled && (
          <span className="text-xs text-muted-foreground/70 tabular-nums">
            {images.length}/{MAX_PER_CATEGORY}
          </span>
        )}
      </div>

      {images.length > 0 ? (
        <div className="grid grid-cols-2 gap-2">
          {images.map((img) => (
            <div key={img.id} className="group/img relative">
              <button
                type="button"
                onClick={() => onZoom(img)}
                className="block w-full overflow-hidden rounded-md focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
                aria-label="View screenshot full size"
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={img.url}
                  alt={label}
                  className="aspect-video w-full object-cover transition-transform group-hover/img:scale-[1.02]"
                />
                <span className="pointer-events-none absolute inset-0 flex items-center justify-center bg-black/0 opacity-0 transition-opacity group-hover/img:bg-black/30 group-hover/img:opacity-100">
                  <ZoomIn className="size-5 text-white" />
                </span>
              </button>
              {uploadsEnabled && (
                <Button
                  type="button"
                  variant="destructive"
                  size="icon-xs"
                  aria-label="Delete screenshot"
                  className="absolute top-1 right-1 opacity-0 transition-opacity group-hover/img:opacity-100 focus-visible:opacity-100"
                  onClick={() => setPendingDelete(img)}
                >
                  <Trash2 />
                </Button>
              )}
            </div>
          ))}
        </div>
      ) : (
        <p className="text-xs text-muted-foreground/40 italic">No images.</p>
      )}

      {uploadsEnabled && (
        <>
          <input
            ref={inputRef}
            type="file"
            accept="image/*"
            multiple
            className="hidden"
            onChange={(e) => onFilesPicked(e.target.files)}
          />
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="mt-2 w-full"
            disabled={!canUpload}
            onClick={() => inputRef.current?.click()}
          >
            {isUploading ? (
              <>
                <Loader2 className="animate-spin" /> Uploading…
              </>
            ) : remaining > 0 ? (
              <>
                <Plus /> Add image
              </>
            ) : (
              "Limit reached"
            )}
          </Button>
        </>
      )}

      <ConfirmDialog
        open={pendingDelete != null}
        onOpenChange={(open) => !open && setPendingDelete(null)}
        title="Delete screenshot?"
        description="This permanently removes the image from this trade and from storage."
        confirmLabel="Delete"
        variant="destructive"
        isPending={isDeleting}
        onConfirm={confirmDelete}
      />
    </div>
  );
}
