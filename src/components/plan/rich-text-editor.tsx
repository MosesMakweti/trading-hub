"use client";

import dynamic from "next/dynamic";

import type { RichTextEditorProps } from "./rich-text-editor-impl";

// Tiptap (the editor runtime + StarterKit) is heavy and never renders on the
// server (`immediatelyRender: false`), so it's lazy-loaded here — kept off the
// initial JS of every route that embeds an editor (journal, edge, strategy-lab,
// today). The skeleton mirrors the editor's own frame so there is no layout shift.
const RichTextEditorImpl = dynamic(
  () => import("./rich-text-editor-impl").then((m) => m.RichTextEditorImpl),
  {
    ssr: false,
    loading: () => (
      <div className="space-y-2">
        <div className="rounded-lg border border-border bg-background/40 px-3 py-2">
          <div className="min-h-[120px] animate-pulse rounded bg-muted/20" aria-hidden />
        </div>
        <p className="h-4" />
      </div>
    ),
  },
);

export function RichTextEditor(props: RichTextEditorProps) {
  return <RichTextEditorImpl {...props} />;
}
