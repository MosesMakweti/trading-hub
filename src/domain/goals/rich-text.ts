/**
 * Whether a stored rich-text document (Tiptap JSON) contains any visible
 * text. An empty editor saves a document with empty paragraphs, which must
 * not count as a journal entry.
 */
export function richTextHasContent(doc: unknown, depth = 0): boolean {
  if (depth > 50 || doc == null) return false;
  if (typeof doc === "string") return doc.trim().length > 0;
  if (Array.isArray(doc)) return doc.some((d) => richTextHasContent(d, depth + 1));
  if (typeof doc !== "object") return false;
  const node = doc as { type?: unknown; text?: unknown; content?: unknown };
  if (node.type === "text") return typeof node.text === "string" && node.text.trim().length > 0;
  if (node.type === "image") return true;
  return richTextHasContent(node.content, depth + 1);
}
