"use client";

import { useRef, useState } from "react";
import { toast } from "sonner";
import { FileSpreadsheet, UploadCloud } from "lucide-react";

import { cn } from "@/lib/utils";
import { MAX_MT5_IMPORT_FILE_SIZE_BYTES } from "@/lib/validation/mt5-import";

export interface LoadedMt5File {
  fileName: string;
  contentBase64: string;
  sizeBytes: number;
}

/** §8 — CSV/TXT only, deliberately narrower than the account-history
 *  importer's dropzone (XLSX/HTML/XML/MT4/cTrader/NinjaTrader/Tradovate are
 *  all explicitly out of scope here — see `types.ts`'s own doc comment on
 *  the one supported MT5 bar-history shape). */
const ACCEPT_ATTR = [".csv", ".txt", "text/csv", "text/plain", "application/octet-stream"].join(",");
const REJECTED_EXT = /\.(zip|rar|7z|gz|tar|pdf|docx?|pptx?|xlsx?|html?|xml|exe|dll|dmg|png|jpe?g|gif|webp|svg)$/i;

function fileExtension(name: string): string {
  const m = /\.([a-z0-9]+)$/i.exec(name.trim());
  return m ? m[1].toLowerCase() : "";
}

function looksLikeSupported(file: File): { ok: true } | { ok: false; reason: string } {
  if (REJECTED_EXT.test(file.name)) {
    return { ok: false, reason: "That file type isn't supported here — export a CSV or TXT bar-history file from MT5." };
  }
  const ext = fileExtension(file.name);
  if (ext === "csv" || ext === "txt") return { ok: true };
  const genericOrKnown = file.type === "" || file.type === "application/octet-stream" || file.type.startsWith("text/");
  return genericOrKnown ? { ok: true } : { ok: false, reason: "Unsupported file format. Use CSV or TXT." };
}

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

export function Mt5ImportDropzone({
  loadedFileName,
  onLoaded,
}: {
  loadedFileName: string | null;
  onLoaded: (file: LoadedMt5File) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragActive, setDragActive] = useState(false);
  const [reading, setReading] = useState(false);

  async function accept(file: File) {
    const check = looksLikeSupported(file);
    if (!check.ok) {
      toast.error(check.reason);
      return;
    }
    if (file.size > MAX_MT5_IMPORT_FILE_SIZE_BYTES) {
      toast.error(`That file is larger than the ${Math.round(MAX_MT5_IMPORT_FILE_SIZE_BYTES / 1_000_000)}MB limit.`);
      return;
    }
    if (file.size === 0) {
      toast.error("That file is empty.");
      return;
    }
    setReading(true);
    try {
      const buffer = await file.arrayBuffer();
      onLoaded({ fileName: file.name, contentBase64: arrayBufferToBase64(buffer), sizeBytes: file.size });
    } catch {
      toast.error("Couldn't read that file.");
    } finally {
      setReading(false);
    }
  }

  return (
    <div
      role="button"
      tabIndex={0}
      aria-label="Upload MT5 candle history (CSV or TXT)"
      className={cn(
        "flex flex-col items-center gap-2 rounded-xl border border-dashed border-border px-4 py-8 text-center transition-colors",
        dragActive && "border-primary/60 bg-accent/40",
        reading && "cursor-not-allowed opacity-70",
      )}
      onDragOver={(e) => {
        e.preventDefault();
        if (!reading) setDragActive(true);
      }}
      onDragLeave={() => setDragActive(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDragActive(false);
        const file = e.dataTransfer.files[0];
        if (file) void accept(file);
      }}
      onClick={() => !reading && inputRef.current?.click()}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          inputRef.current?.click();
        }
      }}
    >
      <input
        ref={inputRef}
        type="file"
        accept={ACCEPT_ATTR}
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) void accept(file);
          e.target.value = "";
        }}
      />
      {loadedFileName ? (
        <>
          <FileSpreadsheet className="size-6 text-primary" />
          <p className="text-sm font-medium">{loadedFileName}</p>
          <p className="text-xs text-muted-foreground">Click to choose a different file</p>
        </>
      ) : (
        <>
          <UploadCloud className="size-6 text-muted-foreground" />
          <p className="text-sm font-medium">{reading ? "Reading…" : "Drop an MT5 bar-history export here"}</p>
          <p className="text-xs text-muted-foreground">
            CSV or TXT from MT5&apos;s History Center → Export · up to {Math.round(MAX_MT5_IMPORT_FILE_SIZE_BYTES / 1_000_000)}MB
          </p>
        </>
      )}
    </div>
  );
}
