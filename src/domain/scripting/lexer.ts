/**
 * Traditorium Script lexer (Pine Script®-style syntax, documented subset — see README.md).
 *
 * Blocks are indentation-based, as in Pine: a block's lines are indented by
 * one level (4 spaces or a tab) more than its header. A line indented by a
 * number of spaces that is NOT a multiple of 4 continues the previous line
 * (Pine's line-wrapping rule); newlines inside ( ) or [ ] are ignored.
 */

export type TokenType = "num" | "str" | "ident" | "color" | "op" | "kw" | "newline" | "indent" | "dedent" | "eof";

export interface Token {
  type: TokenType;
  value: string;
  line: number;
  col: number;
}

export class ScriptSyntaxError extends Error {
  constructor(
    message: string,
    public line: number,
    public col: number,
  ) {
    super(message);
    this.name = "ScriptSyntaxError";
  }
}

export const KEYWORDS = new Set(["if", "else", "for", "to", "by", "while", "var", "varip", "true", "false", "and", "or", "not", "break", "continue", "na", "import", "export", "type", "method", "switch", "enum", "in"]);

const OPS = [":=", "=>", "==", "!=", "<=", ">=", "+=", "-=", "*=", "/=", "%=", "+", "-", "*", "/", "%", "<", ">", "=", "?", ":", "(", ")", "[", "]", ",", "."];

export function tokenize(source: string): Token[] {
  const tokens: Token[] = [];
  const indents = [0];
  const lines = source.replace(/\r\n?/g, "\n").split("\n");
  let depth = 0; // ( [ nesting

  for (let ln = 0; ln < lines.length; ln++) {
    const raw = lines[ln];
    const lineNo = ln + 1;
    const stripped = stripComment(raw);
    if (stripped.trim() === "") continue;

    const indentStr = stripped.match(/^[ \t]*/)![0];
    const indent = [...indentStr].reduce((n, ch) => n + (ch === "\t" ? 4 : 1), 0);
    const continuation = depth > 0 || (indent % 4 !== 0 && tokens.length > 0);

    if (!continuation) {
      if (tokens.length > 0) tokens.push({ type: "newline", value: "\n", line: lineNo - 1, col: 0 });
      const level = indent;
      if (level > indents[indents.length - 1]) {
        indents.push(level);
        tokens.push({ type: "indent", value: "", line: lineNo, col: 1 });
      } else {
        while (level < indents[indents.length - 1]) {
          indents.pop();
          tokens.push({ type: "dedent", value: "", line: lineNo, col: 1 });
        }
        if (level !== indents[indents.length - 1]) throw new ScriptSyntaxError("Inconsistent indentation.", lineNo, 1);
      }
    }

    let i = indentStr.length;
    const s = stripped;
    while (i < s.length) {
      const ch = s[i];
      const col = i + 1;
      if (ch === " " || ch === "\t") {
        i++;
        continue;
      }
      if (/[0-9]/.test(ch) || (ch === "." && /[0-9]/.test(s[i + 1] ?? ""))) {
        const m = s.slice(i).match(/^(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?/)!;
        tokens.push({ type: "num", value: m[0], line: lineNo, col });
        i += m[0].length;
        continue;
      }
      if (ch === '"' || ch === "'") {
        let j = i + 1;
        let val = "";
        while (j < s.length && s[j] !== ch) {
          if (s[j] === "\\" && j + 1 < s.length) {
            const e = s[j + 1];
            val += e === "n" ? "\n" : e === "t" ? "\t" : e;
            j += 2;
          } else val += s[j++];
        }
        if (j >= s.length) throw new ScriptSyntaxError("Unterminated string.", lineNo, col);
        tokens.push({ type: "str", value: val, line: lineNo, col });
        i = j + 1;
        continue;
      }
      if (ch === "#") {
        const m = s.slice(i).match(/^#([0-9a-fA-F]{6}|[0-9a-fA-F]{8})\b/);
        if (!m) throw new ScriptSyntaxError("A color literal is # followed by 6 or 8 hex digits.", lineNo, col);
        tokens.push({ type: "color", value: m[0], line: lineNo, col });
        i += m[0].length;
        continue;
      }
      if (/[A-Za-z_]/.test(ch)) {
        const m = s.slice(i).match(/^[A-Za-z_][A-Za-z0-9_]*/)!;
        tokens.push({ type: KEYWORDS.has(m[0]) ? "kw" : "ident", value: m[0], line: lineNo, col });
        i += m[0].length;
        continue;
      }
      const op = OPS.find((o) => s.startsWith(o, i));
      if (!op) throw new ScriptSyntaxError(`Unexpected character "${ch}".`, lineNo, col);
      if (op === "(" || op === "[") depth++;
      if (op === ")" || op === "]") depth = Math.max(0, depth - 1);
      tokens.push({ type: "op", value: op, line: lineNo, col });
      i += op.length;
    }
  }
  tokens.push({ type: "newline", value: "\n", line: lines.length, col: 0 });
  while (indents.length > 1) {
    indents.pop();
    tokens.push({ type: "dedent", value: "", line: lines.length, col: 0 });
  }
  tokens.push({ type: "eof", value: "", line: lines.length, col: 0 });
  return tokens;
}

/** Removes a // comment that is not inside a string. */
function stripComment(line: string): string {
  let quote: string | null = null;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (quote) {
      if (ch === "\\") i++;
      else if (ch === quote) quote = null;
    } else if (ch === '"' || ch === "'") quote = ch;
    else if (ch === "/" && line[i + 1] === "/") return line.slice(0, i);
  }
  return line;
}

/** The `//@version=N` annotation, if present. */
export function versionOf(source: string): number | null {
  const m = source.match(/^\s*\/\/@version=(\d+)/m);
  return m ? Number(m[1]) : null;
}
