"use client";

import { useEffect, useRef } from "react";
import { EditorState, Compartment } from "@codemirror/state";
import { EditorView, keymap, lineNumbers, highlightActiveLine, highlightActiveLineGutter, drawSelection, hoverTooltip } from "@codemirror/view";
import { defaultKeymap, history, historyKeymap, indentWithTab, toggleComment } from "@codemirror/commands";
import { StreamLanguage, HighlightStyle, syntaxHighlighting, bracketMatching, indentUnit } from "@codemirror/language";
import { autocompletion, closeBrackets, closeBracketsKeymap, completionKeymap, type CompletionContext } from "@codemirror/autocomplete";
import { linter, lintGutter, type Diagnostic } from "@codemirror/lint";
import { tags as t } from "@lezer/highlight";

import { BUILTINS, BUILTIN_BY_NAME } from "@/domain/scripting/builtins";

/**
 * Code editor for Traditorium Script (CodeMirror 6). Syntax colouring,
 * autocomplete and hover help come from the built-ins catalogue; diagnostics
 * are supplied by the caller (syntax check in the page, runtime errors from
 * the sandboxed run).
 */

const KEYWORDS = new Set(["if", "else", "for", "to", "by", "while", "var", "varip", "and", "or", "not", "break", "continue", "import", "export", "type", "method", "switch", "enum", "in"]);
const ATOMS = new Set(["true", "false", "na"]);

const scriptLanguage = StreamLanguage.define<{ inString: string | null }>({
  name: "traditorium-script",
  startState: () => ({ inString: null }),
  token(stream) {
    if (stream.eatSpace()) return null;
    if (stream.match("//")) {
      stream.skipToEnd();
      return "comment";
    }
    const ch = stream.peek();
    if (ch === '"' || ch === "'") {
      stream.next();
      let escaped = false;
      while (!stream.eol()) {
        const c = stream.next();
        if (c === ch && !escaped) break;
        escaped = !escaped && c === "\\";
      }
      return "string";
    }
    if (stream.match(/^#[0-9a-fA-F]{6}([0-9a-fA-F]{2})?/)) return "color";
    if (stream.match(/^(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?/)) return "number";
    if (stream.match(/^[A-Za-z_][A-Za-z0-9_]*(\.[A-Za-z_][A-Za-z0-9_]*)*/)) {
      const w = stream.current();
      if (KEYWORDS.has(w)) return "keyword";
      if (ATOMS.has(w)) return "atom";
      if (BUILTIN_BY_NAME.has(w)) return BUILTIN_BY_NAME.get(w)!.kind === "function" ? "builtin" : "variableName.special";
      if (/^(ta|math|str|color|input|strategy|plot|shape|location|log|barstate)\./.test(w)) return "builtin";
      return "variableName";
    }
    if (stream.match(/^(:=|=>|==|!=|<=|>=|\+=|-=|\*=|\/=|%=|[-+*/%<>=?:])/)) return "operator";
    stream.next();
    return null;
  },
  languageData: { commentTokens: { line: "//" } },
  tokenTable: { color: t.color, builtin: t.standard(t.function(t.variableName)), "variableName.special": t.special(t.variableName) },
});

const highlight = HighlightStyle.define([
  { tag: t.comment, color: "var(--muted-foreground)", fontStyle: "italic" },
  { tag: t.keyword, color: "#c678dd" },
  { tag: t.atom, color: "#d19a66" },
  { tag: t.number, color: "#d19a66" },
  { tag: t.string, color: "#98c379" },
  { tag: t.color, color: "#56b6c2" },
  { tag: t.operator, color: "#56b6c2" },
  { tag: t.standard(t.function(t.variableName)), color: "#61afef" },
  { tag: t.special(t.variableName), color: "#e5c07b" },
]);

const theme = EditorView.theme({
  "&": { height: "100%", fontSize: "12.5px", backgroundColor: "transparent", color: "var(--foreground)" },
  ".cm-scroller": { fontFamily: "var(--font-mono, ui-monospace, monospace)", lineHeight: "1.55" },
  ".cm-gutters": { backgroundColor: "transparent", borderRight: "1px solid var(--border)", color: "var(--muted-foreground)" },
  ".cm-activeLine, .cm-activeLineGutter": { backgroundColor: "color-mix(in oklab, var(--muted) 55%, transparent)" },
  "&.cm-focused": { outline: "none" },
  ".cm-cursor": { borderLeftColor: "var(--foreground)" },
  ".cm-selectionBackground, &.cm-focused .cm-selectionBackground": { backgroundColor: "color-mix(in oklab, var(--primary) 25%, transparent) !important" },
  ".cm-tooltip": { backgroundColor: "var(--popover)", color: "var(--popover-foreground)", border: "1px solid var(--border)", borderRadius: "6px" },
  ".cm-tooltip-autocomplete ul li[aria-selected]": { backgroundColor: "var(--accent)", color: "var(--accent-foreground)" },
  ".cm-script-doc": { padding: "6px 8px", maxWidth: "26rem", fontSize: "12px" },
  ".cm-script-doc code": { fontFamily: "var(--font-mono, ui-monospace, monospace)", fontSize: "11.5px" },
});

function complete(ctx: CompletionContext) {
  const word = ctx.matchBefore(/[A-Za-z_][A-Za-z0-9_.]*/);
  if (!word || (word.from === word.to && !ctx.explicit)) return null;
  return {
    from: word.from,
    options: BUILTINS.map((b) => ({ label: b.name, type: b.kind === "function" ? "function" : b.kind === "keyword" ? "keyword" : b.kind === "constant" ? "constant" : "variable", detail: b.signature ? b.signature.slice(b.name.length) : undefined, info: b.doc })),
    validFor: /^[A-Za-z0-9_.]*$/,
  };
}

const hover = hoverTooltip((view, pos) => {
  const line = view.state.doc.lineAt(pos);
  const text = line.text;
  let s = pos - line.from;
  let e = s;
  while (s > 0 && /[\w.]/.test(text[s - 1])) s--;
  while (e < text.length && /[\w.]/.test(text[e])) e++;
  const word = text.slice(s, e);
  const doc = BUILTIN_BY_NAME.get(word);
  if (!doc || doc.kind === "keyword") return null;
  return {
    pos: line.from + s,
    end: line.from + e,
    above: true,
    create() {
      const dom = document.createElement("div");
      dom.className = "cm-script-doc";
      const code = document.createElement("code");
      code.textContent = doc.signature ?? doc.name;
      const p = document.createElement("div");
      p.textContent = doc.doc;
      dom.append(code, p);
      return { dom };
    },
  };
});

export interface EditorDiagnostic {
  line: number;
  col?: number | null;
  message: string;
  severity: "error" | "warning";
}

export function ScriptCodeEditor({ value, onChange, onSave, diagnostics, readOnly = false, ariaLabel = "Script source" }: { value: string; onChange: (v: string) => void; onSave?: () => void; diagnostics: EditorDiagnostic[]; readOnly?: boolean; ariaLabel?: string }) {
  const host = useRef<HTMLDivElement>(null);
  const view = useRef<EditorView | null>(null);
  const cb = useRef({ onChange, onSave, diagnostics });
  const ro = useRef(new Compartment());
  const lint = useRef(new Compartment());

  useEffect(() => {
    cb.current = { onChange, onSave, diagnostics };
  });

  useEffect(() => {
    if (!host.current) return;
    const v = new EditorView({
      parent: host.current,
      state: EditorState.create({
        doc: value,
        extensions: [
          lineNumbers(),
          highlightActiveLineGutter(),
          highlightActiveLine(),
          drawSelection(),
          history(),
          bracketMatching(),
          closeBrackets(),
          indentUnit.of("    "),
          EditorState.tabSize.of(4),
          scriptLanguage,
          syntaxHighlighting(highlight),
          autocompletion({ override: [complete] }),
          hover,
          lintGutter(),
          lint.current.of([]),
          ro.current.of(EditorState.readOnly.of(readOnly)),
          keymap.of([
            { key: "Mod-s", preventDefault: true, run: () => (cb.current.onSave?.(), true) },
            { key: "Mod-/", run: toggleComment },
            ...closeBracketsKeymap,
            ...completionKeymap,
            ...historyKeymap,
            indentWithTab,
            ...defaultKeymap,
          ]),
          EditorView.updateListener.of((u) => {
            if (u.docChanged) cb.current.onChange(u.state.doc.toString());
          }),
          EditorView.contentAttributes.of({ "aria-label": ariaLabel }),
          theme,
        ],
      }),
    });
    view.current = v;
    return () => {
      v.destroy();
      view.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- created once; value/readOnly are synced below
  }, []);

  // External value changes (switching script, restoring a version).
  useEffect(() => {
    const v = view.current;
    if (v && v.state.doc.toString() !== value) v.dispatch({ changes: { from: 0, to: v.state.doc.length, insert: value } });
  }, [value]);

  useEffect(() => {
    view.current?.dispatch({ effects: ro.current.reconfigure(EditorState.readOnly.of(readOnly)) });
  }, [readOnly]);

  // Diagnostics → lint source (re-registered when they change).
  useEffect(() => {
    const v = view.current;
    if (!v) return;
    const source = linter(
      (view) => {
        const doc = view.state.doc;
        return cb.current.diagnostics
          .filter((d) => d.line >= 1 && d.line <= doc.lines)
          .map((d): Diagnostic => {
            const line = doc.line(d.line);
            const from = Math.min(line.to, line.from + Math.max(0, (d.col ?? 1) - 1));
            return { from: d.col ? from : line.from, to: line.to > from ? line.to : from, severity: d.severity, message: d.message };
          });
      },
      { delay: 0 },
    );
    v.dispatch({ effects: lint.current.reconfigure(source) });
  }, [diagnostics]);

  return <div ref={host} className="h-full min-h-0 overflow-hidden" />;
}
