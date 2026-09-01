"use client";

import { useRef, useState } from "react";
import { toast } from "sonner";
import { FileSpreadsheet, UploadCloud } from "lucide-react";

import { cn } from "@/lib/utils";
import { MAX_IMPORT_FILE_SIZE_BYTES } from "@/lib/validation/prop-firm-import";

export interface LoadedFile {
  fileName: string;
  /** The raw file, base64-encoded — binary-safe for XLSX/XLS. */
  contentBase64: string;
  mimeType: string;
  sizeBytes: number;
}

const SUPPORTED_EXTENSIONS = ["csv", "tsv", "txt", "xlsx", "xls", "html", "htm", "xml"];

const ACCEPT_ATTR = [
  ".csv",
  ".tsv",
  ".txt",
  ".xlsx",
  ".xls",
  ".html",
  ".htm",
  ".xml",
  "text/csv",
  "text/tab-separated-values",
  "text/plain",
  "text/html",
  "application/xml",
  "text/xml",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/octet-stream",
].join(",");

/** Clearly-not-a-statement types we reject client-side before reading. The
 *  server still does the authoritative content-signature check. */
const REJECTED_MIME = /^(image|audio|video)\//;
const REJECTED_EXT = /\.(zip|rar|7z|gz|tar|pdf|docx?|pptx?|exe|dll|dmg|png|jpe?g|gif|webp|svg)$/i;

function fileExtension(name: string): string {
  const m = /\.([a-z0-9]+)$/i.exec(name.trim());
  return m ? m[1].toLowerCase() : "";
}

function looksLikeSupported(file: File): { ok: true } | { ok: false; reason: string } {
  if (REJECTED_EXT.test(file.name) || REJECTED_MIME.test(file.type)) {
    return { ok: false, reason: "That file type isn't a supported statement format." };
  }
  const ext = fileExtension(file.name);
  if (SUPPORTED_EXTENSIONS.includes(ext)) return { ok: true };
  // Unknown/absent extension — allow through when the MIME is a known-good or
  // generic type (some browsers send application/octet-stream for .csv/.xls).
  const genericOrKnown =
    file.type === "" ||
    file.type === "application/octet-stream" ||
    file.type.startsWith("text/") ||
    file.type.includes("spreadsheet") ||
    file.type.includes("xml") ||
    file.type.includes("excel");
  return genericOrKnown
    ? { ok: true }
    : { ok: false, reason: "Unsupported file format. Use CSV, Excel, HTML, or XML." };
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

export function ImportDropzone({
  loadedFileName,
  onLoaded,
}: {
  loadedFileName: string | null;
  onLoaded: (file: LoadedFile) => void;
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
    if (file.size > MAX_IMPORT_FILE_SIZE_BYTES) {
      toast.error(`That file is larger than the ${MAX_IMPORT_FILE_SIZE_BYTES / 1_000_000}MB limit.`);
      return;
    }
    if (file.size === 0) {
      toast.error("That file is empty.");
      return;
    }
    setReading(true);
    try {
      const buffer = await file.arrayBuffer();
      onLoaded({
        fileName: file.name,
        contentBase64: arrayBufferToBase64(buffer),
        mimeType: file.type || "",
        sizeBytes: file.size,
      });
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
      aria-label="Upload a broker or prop-firm statement"
      className={cn(
        "flex flex-col items-center gap-2 rounded-xl border border-dashed border-border px-4 py-10 text-center transition-colors",
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
          <FileSpreadsheet className="size-7 text-primary" />
          <p className="text-sm font-medium">{loadedFileName}</p>
          <p className="text-xs text-muted-foreground">Click to choose a different file</p>
        </>
      ) : (
        <>
          <UploadCloud className="size-7 text-muted-foreground" />
          <p className="text-sm font-medium">{reading ? "Reading…" : "Drop a statement here"}</p>
          <p className="text-xs text-muted-foreground">
            CSV, Excel, HTML or XML from MT4, MT5, cTrader, NinjaTrader, Tradovate or any broker · up to{" "}
            {MAX_IMPORT_FILE_SIZE_BYTES / 1_000_000}MB
          </p>
        </>
      )}
    </div>
  );
}
