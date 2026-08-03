import { ImageOff } from "lucide-react";

import { ComingSoon } from "@/components/journal/workspace/workspace-ui";
import type { TradeWorkspaceDTO, TradeWorkspaceImageDTO } from "@/types/trades";

const CATEGORIES: { key: TradeWorkspaceImageDTO["category"]; label: string }[] = [
  { key: "ANALYSIS", label: "Analysis charts" },
  { key: "BEFORE", label: "Before trade" },
  { key: "AFTER", label: "After trade" },
];

// Unified attachments. Upload/preview/zoom/delete land when image hosting
// (UploadThing) is connected — deferred app-wide. Existing images (if any) render.
export function TradeAttachmentsSection({ trade }: { trade: TradeWorkspaceDTO }) {
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        {CATEGORIES.map((cat) => {
          const images = trade.images.filter((i) => i.category === cat.key);
          return (
            <div key={cat.key} className="rounded-xl border border-border bg-background/40 p-3">
              <div className="mb-2 text-xs font-medium text-muted-foreground">{cat.label}</div>
              {images.length ? (
                <div className="grid grid-cols-2 gap-2">
                  {images.map((img) => (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      key={img.id}
                      src={img.url}
                      alt={cat.label}
                      className="aspect-video w-full rounded-md object-cover"
                    />
                  ))}
                </div>
              ) : (
                <p className="text-xs text-muted-foreground/40 italic">No images.</p>
              )}
            </div>
          );
        })}
      </div>
      <p className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
        <ImageOff className="size-3.5" />
        Uploads, preview, zoom, and delete arrive when image hosting is connected.
        <ComingSoon label="Uploads" />
      </p>
    </div>
  );
}
