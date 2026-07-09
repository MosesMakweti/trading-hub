interface TiptapNode {
  type?: string;
  text?: string;
  content?: TiptapNode[];
}

/** Flattens a Tiptap JSON document into a plain-text excerpt, for dashboard previews. */
export function tiptapToPlainText(doc: unknown, maxLength = 160): string {
  if (!doc || typeof doc !== "object") return "";
  const parts: string[] = [];

  function walk(node: TiptapNode) {
    if (node.text) parts.push(node.text);
    if (node.content) {
      for (const child of node.content) walk(child);
      if (node.type === "paragraph") parts.push(" ");
    }
  }

  walk(doc as TiptapNode);
  const text = parts.join("").replace(/\s+/g, " ").trim();
  return text.length > maxLength ? `${text.slice(0, maxLength)}…` : text;
}
