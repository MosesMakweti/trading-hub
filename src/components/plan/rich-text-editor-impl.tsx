"use client";

import { useEffect, useRef, useState } from "react";
import { EditorContent, useEditor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Placeholder from "@tiptap/extension-placeholder";

import { cn } from "@/lib/utils";

const AUTOSAVE_DELAY_MS = 1200;

type SaveResult = { success: boolean; error?: string };

export type RichTextEditorProps = {
  initialContent: unknown;
  placeholder?: string;
  onSave: (content: object) => Promise<SaveResult>;
  className?: string;
  editable?: boolean;
};

export function RichTextEditorImpl({
  initialContent,
  placeholder,
  onSave,
  className,
  editable = true,
}: RichTextEditorProps) {
  const [status, setStatus] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const saveTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);

  const editor = useEditor({
    editable,
    extensions: [
      StarterKit,
      Placeholder.configure({ placeholder: placeholder ?? "Start writing..." }),
    ],
    content: (initialContent as object) ?? "",
    immediatelyRender: false,
    editorProps: {
      attributes: {
        class:
          "prose prose-invert prose-sm max-w-none focus:outline-none min-h-[120px] text-foreground",
      },
    },
    onUpdate: ({ editor }) => {
      setStatus("saving");
      if (saveTimeout.current) clearTimeout(saveTimeout.current);
      saveTimeout.current = setTimeout(async () => {
        const result = await onSave(editor.getJSON());
        setStatus(result.success ? "saved" : "error");
      }, AUTOSAVE_DELAY_MS);
    },
  });

  useEffect(() => {
    return () => {
      if (saveTimeout.current) clearTimeout(saveTimeout.current);
    };
  }, []);

  return (
    <div className={cn("space-y-2", className)}>
      <div className="rounded-lg border border-border bg-background/40 px-3 py-2">
        <EditorContent editor={editor} />
      </div>
      <p className="h-4 text-xs text-muted-foreground">
        {status === "saving" && "Saving…"}
        {status === "saved" && "Saved"}
        {status === "error" && <span className="text-danger">Failed to save</span>}
      </p>
    </div>
  );
}
