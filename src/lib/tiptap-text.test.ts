import { describe, expect, it } from "vitest";

import { tiptapToPlainText } from "./tiptap-text";

describe("tiptapToPlainText", () => {
  it("flattens paragraphs and text nodes into plain text", () => {
    const doc = {
      type: "doc",
      content: [
        { type: "paragraph", content: [{ type: "text", text: "First line." }] },
        { type: "paragraph", content: [{ type: "text", text: "Second line." }] },
      ],
    };
    expect(tiptapToPlainText(doc)).toBe("First line. Second line.");
  });

  it("returns an empty string for null/undefined content", () => {
    expect(tiptapToPlainText(null)).toBe("");
    expect(tiptapToPlainText(undefined)).toBe("");
  });

  it("truncates with an ellipsis past maxLength", () => {
    const doc = { type: "doc", content: [{ type: "text", text: "a".repeat(200) }] };
    const result = tiptapToPlainText(doc, 10);
    expect(result).toBe(`${"a".repeat(10)}…`);
  });
});
