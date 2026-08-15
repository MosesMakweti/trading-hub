"use client";

import { useCallback, useRef, useState } from "react";
import { toast } from "sonner";
import { Camera, Loader2, UploadCloud } from "lucide-react";

import { cn } from "@/lib/utils";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ACCEPTED_IMAGE_MIME, MAX_FILE_SIZE } from "@/lib/media-constants";
import { attachPlanScreenshotAction, pickExistingScreenshotAction } from "@/actions/trade-plan.actions";
import type { MediaItemDTO } from "@/server/services/media.service";

const ACCEPTED = new Set<string>(ACCEPTED_IMAGE_MIME);

/** mediaUrl(assetId) is always "/api/media/{assetId}" (media.service.ts) —
 *  the upload response only carries the attachment id + that URL, so this
 *  is how we recover the underlying MediaAsset id to hand to
 *  attachPlanScreenshotAction (which wraps an ASSET, not an attachment). */
function assetIdFromUrl(url: string): string {
  return url.split("/").filter(Boolean).pop() ?? "";
}

/**
 * "Create plan from TradingView screenshot" — upload (click/drag/paste) or
 * pick an existing Before-Trade image (spec §1). Uploads reuse the app's own
 * authenticated /api/media/upload route (ownerType=TRADE, category=BEFORE) —
 * identical validation/ownership path as every other image upload in
 * TradeOS — then wraps the resulting asset into this trade's plan via
 * attachPlanScreenshotAction.
 */
export function PlanScreenshotDropzone({
  dateKey,
  tradeId,
  existingBeforeImages,
  onAttached,
}: {
  dateKey: string;
  tradeId: string;
  existingBeforeImages: MediaItemDTO[];
  onAttached: () => void;
}) {
  const [dragActive, setDragActive] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [pickerValue, setPickerValue] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const upload = useCallback(
    (file: File) => {
      if (!ACCEPTED.has(file.type)) {
        toast.error("Only image files (PNG, JPEG, WebP, …) can be uploaded.");
        return;
      }
      if (file.size > MAX_FILE_SIZE) {
        toast.error("Image is larger than the 8MB limit.");
        return;
      }

      setIsUploading(true);
      const form = new FormData();
      form.set("ownerType", "TRADE");
      form.set("ownerId", tradeId);
      form.set("category", "BEFORE");
      form.append("files", file);

      fetch("/api/media/upload", { method: "POST", body: form })
        .then(async (res) => {
          const body = await res.json();
          if (!res.ok) throw new Error(body.error ?? "Upload failed.");
          const item = body.items?.[0];
          if (!item) throw new Error("Upload failed.");
          const result = await attachPlanScreenshotAction(dateKey, tradeId, { mediaAssetId: assetIdFromUrl(item.url) });
          if (!result.success) throw new Error(result.error);
          toast.success("Screenshot uploaded.");
          onAttached();
        })
        .catch((e: unknown) => toast.error(e instanceof Error ? e.message : "Upload failed."))
        .finally(() => setIsUploading(false));
    },
    [dateKey, tradeId, onAttached],
  );

  async function pickExistingImage(mediaAttachmentId: string) {
    setPickerValue(mediaAttachmentId);
    setIsUploading(true);
    const result = await pickExistingScreenshotAction(dateKey, tradeId, { mediaAttachmentId });
    setIsUploading(false);
    if (!result.success) {
      toast.error(result.error);
      setPickerValue("");
      return;
    }
    toast.success("Using this image as the plan screenshot.");
    onAttached();
  }

  function handlePaste(e: React.ClipboardEvent<HTMLDivElement>) {
    const item = Array.from(e.clipboardData.items).find((i) => i.type.startsWith("image/"));
    if (!item) return;
    const file = item.getAsFile();
    if (file) {
      e.preventDefault();
      upload(file);
    }
  }

  return (
    <div className="space-y-2">
      <div
        ref={containerRef}
        role="button"
        tabIndex={0}
        onPaste={handlePaste}
        onClick={() => !isUploading && inputRef.current?.click()}
        onKeyDown={(e) => e.key === "Enter" && inputRef.current?.click()}
        onDragOver={(e) => {
          e.preventDefault();
          if (!isUploading) setDragActive(true);
        }}
        onDragLeave={() => setDragActive(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragActive(false);
          const file = e.dataTransfer.files[0];
          if (file) upload(file);
        }}
        className={cn(
          "glass flex w-full flex-col items-center justify-center gap-2 rounded-xl border border-dashed px-4 py-8 text-center transition-colors focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",
          dragActive ? "border-primary/60 bg-accent/40" : "border-border",
          isUploading && "cursor-not-allowed opacity-70",
        )}
      >
        <input
          ref={inputRef}
          type="file"
          accept={ACCEPTED_IMAGE_MIME.join(",")}
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) upload(file);
            e.target.value = "";
          }}
        />
        {isUploading ? (
          <Loader2 className="size-5 animate-spin text-muted-foreground" />
        ) : (
          <Camera className="size-5 text-muted-foreground" />
        )}
        <div className="text-sm font-medium">Create plan from TradingView screenshot</div>
        <p className="max-w-xs text-xs text-muted-foreground">
          Drop an image, <span className="text-primary">click to upload</span>, or paste from your clipboard
          (⌘V / Ctrl+V) after clicking here.
        </p>
      </div>

      {existingBeforeImages.length > 0 && (
        <div className="flex items-center gap-2">
          <UploadCloud className="size-3.5 shrink-0 text-muted-foreground" />
          <span className="shrink-0 text-xs text-muted-foreground">Or use an existing before-trade image:</span>
          <Select
            items={Object.fromEntries(existingBeforeImages.map((i) => [i.id, i.fileName]))}
            value={pickerValue}
            onValueChange={(v) => v && pickExistingImage(v)}
            disabled={isUploading}
          >
            <SelectTrigger className="h-8 flex-1 text-xs"><SelectValue placeholder="Select an image…" /></SelectTrigger>
            <SelectContent>
              {existingBeforeImages.map((i) => (
                <SelectItem key={i.id} value={i.id}>{i.fileName}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}
    </div>
  );
}
