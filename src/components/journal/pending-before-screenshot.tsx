"use client";

import { useEffect, useMemo, useRef } from "react";
import { ImageOff, UploadCloud, X } from "lucide-react";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { ACCEPTED_IMAGE_MIME } from "@/lib/media-constants";

const MAX_PENDING_FILES = 8;

/**
 * Before-Trade screenshot picker for the "Add Trade Idea" fast path (Stage
 * 5). Reuses the universal media system's TRADE/BEFORE ownerType+category —
 * NOT a second image system — but a brand-new trade has no id yet to upload
 * against, so files are staged locally (never sent anywhere) and only
 * actually uploaded via {@link uploadPendingBeforeScreenshots} once the trade
 * has been created, the same "collect now, persist once the trade exists"
 * pattern the TradingView Trade Plan section already uses for confirmPlanAction.
 * Editing an existing trade already has the full TradeImageBucket gallery in
 * the Trade Workspace — this picker is for the create-time fast path only.
 */
export function PendingBeforeScreenshots({
  files,
  onChange,
}: {
  files: File[];
  onChange: (files: File[]) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const acceptedSet = useMemo(() => new Set<string>(ACCEPTED_IMAGE_MIME), []);
  const previews = useMemo(() => files.map((f) => URL.createObjectURL(f)), [files]);

  useEffect(() => {
    return () => {
      for (const url of previews) URL.revokeObjectURL(url);
    };
  }, [previews]);

  const remaining = MAX_PENDING_FILES - files.length;

  function addFiles(picked: FileList | File[] | null) {
    if (!picked) return;
    const accepted = Array.from(picked).filter((f) => acceptedSet.has(f.type));
    if (accepted.length === 0) return;
    onChange([...files, ...accepted].slice(0, MAX_PENDING_FILES));
  }

  function removeAt(index: number) {
    onChange(files.filter((_, i) => i !== index));
  }

  return (
    <section className="glass space-y-3 rounded-2xl p-4">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-medium text-muted-foreground">Before Trade</h2>
        <span className="text-xs text-muted-foreground/60">
          What the market looked like when you decided this trade was valid
        </span>
      </div>

      {files.length > 0 && (
        <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
          {files.map((file, i) => (
            <div key={`${file.name}-${i}`} className="group/img relative">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={previews[i]}
                alt={file.name}
                className="glass aspect-video w-full rounded-lg object-cover"
              />
              <Button
                type="button"
                variant="destructive"
                size="icon-xs"
                aria-label={`Remove ${file.name}`}
                className="absolute top-1 right-1 opacity-0 transition-opacity group-hover/img:opacity-100 focus-visible:opacity-100"
                onClick={() => removeAt(i)}
              >
                <X />
              </Button>
            </div>
          ))}
        </div>
      )}

      {remaining > 0 ? (
        <>
          <input
            ref={inputRef}
            type="file"
            accept={ACCEPTED_IMAGE_MIME.join(",")}
            multiple
            className="hidden"
            onChange={(e) => {
              addFiles(e.target.files);
              if (inputRef.current) inputRef.current.value = "";
            }}
          />
          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => {
              e.preventDefault();
              addFiles(e.dataTransfer.files);
            }}
            className={cn(
              "glass flex w-full flex-col items-center justify-center gap-1.5 rounded-lg border border-dashed border-border px-3 py-4 text-center transition-colors",
            )}
          >
            <UploadCloud className="size-4 text-muted-foreground" />
            <span className="text-xs text-muted-foreground">
              Drop a chart screenshot or <span className="text-primary">click to add</span>
            </span>
          </button>
        </>
      ) : (
        <p className="flex items-center gap-1.5 text-xs text-muted-foreground/60 italic">
          <ImageOff className="size-3.5" />
          Limit reached ({MAX_PENDING_FILES})
        </p>
      )}

      <p className="text-xs text-muted-foreground/70">
        Saved once you save the trade below. Optional — you can also add or manage before-trade images
        later in the trade&apos;s workspace.
      </p>
    </section>
  );
}

/** Uploads staged files to an existing trade's BEFORE gallery — called once
 *  the trade actually has an id (see PendingBeforeScreenshots' doc comment).
 *  Never throws: a failed screenshot upload must not fail the trade save
 *  that already succeeded (mirrors confirmPlanAction's own error handling). */
export async function uploadPendingBeforeScreenshots(tradeId: string, files: File[]): Promise<string | null> {
  if (files.length === 0) return null;
  try {
    const form = new FormData();
    form.set("ownerType", "TRADE");
    form.set("ownerId", tradeId);
    form.set("category", "BEFORE");
    for (const file of files) form.append("files", file);
    const res = await fetch("/api/media/upload", { method: "POST", body: form });
    if (!res.ok) {
      const body = await res.json().catch(() => null);
      return (body?.error as string | undefined) ?? "Could not upload the before-trade screenshot.";
    }
    return null;
  } catch {
    return "Could not upload the before-trade screenshot.";
  }
}
