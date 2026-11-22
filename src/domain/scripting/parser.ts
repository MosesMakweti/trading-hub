/**
 * Traditorium Script parser → AST. Pine Script®-style syntax, documented
 * subset (README.md). Unsupported v6 features are rejected with an error that
 * names them — never silently accepted.
 */
import { ScriptSyntaxError, tokenize, type Token } from "./lexer";

export type Expr =
  | { k: "num"; v: number; id: number }
  | { k: "str"; v: string; id: number }
  | { k: "bool"; v: boolean; id: number }
  | { k: "na"; id: number }
  | { k: "color"; v: string; id: number }
  | { k: "ident"; name: string; id: number; line: number }
  | { k: "member"; path: string; id: number; line: number }
  | { k: "unary"; op: "-" | "not" | "+"; e: Expr; id: number }
  | { k: "bin"; op: string; l: Expr; r: Expr; id: number; line: number }
  | { k: "ternary"; c: Expr; a: Expr; b: Expr; id: number }
  | { k: "hist"; e: Expr; n: Expr; id: number; line: number }
  | { k: "call"; fn: string; args: Expr[]; named: Record<string, Expr>; id: number; line: number }
  | { k: "tuple"; items: Expr[]; id: number }
  | { k: "ifx"; branches: { cond: Expr | null; body: Stmt[] }[]; id: number; line: number };

export type Stmt =
  | { k: "decl"; name: string; persist: boolean; e: Expr; line: number }
  | { k: "tupleDecl"; names: string[]; e: Expr; line: number }
  | { k: "assign"; name: string; op: string; e: Expr; line: number }
  | { k: "expr"; e: Expr; line: number }
  | { k: "if"; branches: { cond: Expr | null; body: Stmt[] }[]; line: number }
  | { k: "for"; v: string; from: Expr; to: Expr; by: Expr | null; body: Stmt[]; line: number }
  | { k: "while"; cond: Expr; body: Stmt[]; line: number }
  | { k: "break"; line: number }
  | { k: "continue"; line: number }
  | { k: "fn"; name: string; params: { name: string; def: Expr | null }[]; body: Stmt[]; line: number };

export interface Program {
  body: Stmt[];
  /** Number of AST nodes (call sites carry stable ids for per-call-site state). */
  nodes: number;
}

const TYPE_WORDS = new Set(["int", "float", "bool", "string", "color", "series", "simple", "const", "input", "label", "line", "box", "table", "array"]);
const UNSUPPORTED_KW: Record<string, string> = {
  import: "Libraries (import) are not supported yet.",
  export: "Libraries (export) are not supported yet.",
  type: "User-defined types are not supported yet.",
  method: "Methods are not supported yet.",
  switch: "switch is not supported yet — use if / else if.",
  enum: "Enums are not supported yet.",
};

export function parse(source: string): Program {
  const t = tokenize(source);
  let p = 0;
  let nid = 0;
  const id = () => ++nid;

  const peek = (o = 0) => t[p + o];
  const at = (type: Token["type"], value?: string) => peek().type === type && (value === undefined || peek().value === value);
  const fail = (msg: string, tok = peek()): never => {
    throw new ScriptSyntaxError(msg, tok.line, tok.col);
  };
  const eat = (type: Token["type"], value?: string): Token => {
    if (!at(type, value)) fail(`Expected ${value ?? type} but found "${peek().value || peek().type}".`);
    return t[p++];
  };
  const skipNewlines = () => {
    while (at("newline")) p++;
  };

  function block(): Stmt[] {
    eat("newline");
    skipNewlines();
    eat("indent");
    const body: Stmt[] = [];
    while (!at("dedent") && !at("eof")) {
      body.push(statement());
      skipNewlines();
    }
    eat("dedent");
    return body;
  }

  function ifChain(): { cond: Expr | null; body: Stmt[] }[] {
    eat("kw", "if");
    const branches = [{ cond: expr(), body: block() }];
    skipNewlines();
    while (at("kw", "else")) {
      p++;
      if (at("kw", "if")) {
        p++;
        branches.push({ cond: expr(), body: block() });
      } else {
        branches.push({ cond: null, body: block() });
        break;
      }
      skipNewlines();
    }
    return branches;
  }

  function statement(): Stmt {
    const tok = peek();
    const line = tok.line;
    if (tok.type === "kw" && UNSUPPORTED_KW[tok.value]) fail(UNSUPPORTED_KW[tok.value]);
    if (at("kw", "if")) {
      return { k: "if", branches: ifChain(), line };
    }
    if (at("kw", "for")) {
      p++;
      const v = eat("ident").value;
      eat("op", "=");
      const from = expr();
      if (at("kw", "in")) fail("for … in is not supported yet — use for i = a to b.");
      eat("kw", "to");
      const to = expr();
      let by: Expr | null = null;
      if (at("kw", "by")) {
        p++;
        by = expr();
      }
      return { k: "for", v, from, to, by, body: block(), line };
    }
    if (at("kw", "while")) {
      p++;
      return { k: "while", cond: expr(), body: block(), line };
    }
    if (at("kw", "break")) {
      p++;
      return { k: "break", line };
    }
    if (at("kw", "continue")) {
      p++;
      return { k: "continue", line };
    }
    // Tuple declaration: [a, b] = expr
    if (at("op", "[") && lookaheadTupleDecl()) {
      p++;
      const names = [eat("ident").value];
      while (at("op", ",")) {
        p++;
        names.push(eat("ident").value);
      }
      eat("op", "]");
      eat("op", "=");
      return { k: "tupleDecl", names, e: expr(), line };
    }
    // Function definition: name(params) =>
    if (at("ident") && peek(1).type === "op" && peek(1).value === "(" && isFunctionDef()) {
      const name = eat("ident").value;
      eat("op", "(");
      const params: { name: string; def: Expr | null }[] = [];
      while (!at("op", ")")) {
        while (at("ident") && TYPE_WORDS.has(peek().value) && peek(1).type === "ident") p++;
        const pname = eat("ident").value;
        let def: Expr | null = null;
        if (at("op", "=")) {
          p++;
          def = expr();
        }
        params.push({ name: pname, def });
        if (at("op", ",")) p++;
      }
      eat("op", ")");
      eat("op", "=>");
      const body = at("newline") ? block() : [{ k: "expr" as const, e: expr(), line }];
      return { k: "fn", name, params, body, line };
    }
    // Declarations: [var|varip] [type...] name = expr
    let persist = false;
    if (at("kw", "var") || at("kw", "varip")) {
      persist = true;
      p++;
    }
    while (at("ident") && TYPE_WORDS.has(peek().value) && (peek(1).type === "ident" || (peek(1).type === "op" && peek(1).value === "."))) {
      if (peek().value === "array") fail("Arrays are not supported yet.");
      p++;
    }
    if (at("ident") && peek(1).type === "op" && peek(1).value === "=") {
      const name = eat("ident").value;
      p++;
      return { k: "decl", name, persist, e: expr(), line };
    }
    if (persist) fail("Expected a variable declaration after var.");
    if (at("ident") && peek(1).type === "op" && [":=", "+=", "-=", "*=", "/=", "%="].includes(peek(1).value)) {
      const name = eat("ident").value;
      const op = t[p++].value;
      return { k: "assign", name, op, e: expr(), line };
    }
    return { k: "expr", e: expr(), line };
  }

  function lookaheadTupleDecl(): boolean {
    let i = p + 1;
    while (t[i] && !(t[i].type === "op" && t[i].value === "]")) {
      if (t[i].type === "newline") return false;
      i++;
    }
    return !!t[i + 1] && t[i + 1].type === "op" && t[i + 1].value === "=";
  }

  function isFunctionDef(): boolean {
    let depth = 0;
    for (let i = p + 1; i < t.length; i++) {
      const x = t[i];
      if (x.type === "op" && x.value === "(") depth++;
      else if (x.type === "op" && x.value === ")") {
        depth--;
        if (depth === 0) return !!t[i + 1] && t[i + 1].type === "op" && t[i + 1].value === "=>";
      } else if (x.type === "newline") return false;
    }
    return false;
  }

  // ── Expressions (precedence: ternary < or < and < equality < comparison < additive < multiplicative < unary < postfix) ──
  function expr(): Expr {
    if (at("kw", "if")) {
      const line = peek().line;
      return { k: "ifx", branches: ifChain(), id: id(), line };
    }
    const c = orExpr();
    if (at("op", "?")) {
      p++;
      const a = expr();
      eat("op", ":");
      const b = expr();
      return { k: "ternary", c, a, b, id: id() };
    }
    return c;
  }
  function binary(next: () => Expr, ops: string[], kw = false): () => Expr {
    return () => {
      let l = next();
      while ((kw ? peek().type === "kw" : peek().type === "op") && ops.includes(peek().value)) {
        const tok = t[p++];
        l = { k: "bin", op: tok.value, l, r: next(), id: id(), line: tok.line };
      }
      return l;
    };
  }
  const unary = (): Expr => {
    if (at("op", "-") || at("op", "+")) {
      const op = t[p++].value as "-" | "+";
      return { k: "unary", op, e: unary(), id: id() };
    }
    if (at("kw", "not")) {
      p++;
      return { k: "unary", op: "not", e: unary(), id: id() };
    }
    return postfix();
  };
  const mul = binary(unary, ["*", "/", "%"]);
  const add = binary(mul, ["+", "-"]);
  const cmp = binary(add, ["<", ">", "<=", ">="]);
  const eq = binary(cmp, ["==", "!="]);
  const andE = binary(eq, ["and"], true);
  const orExpr = binary(andE, ["or"], true);

  function postfix(): Expr {
    let e = primary();
    while (at("op", "[")) {
      const tok = t[p++];
      const n = expr();
      eat("op", "]");
      e = { k: "hist", e, n, id: id(), line: tok.line };
    }
    return e;
  }

  function primary(): Expr {
    const tok = peek();
    if (tok.type === "num") {
      p++;
      return { k: "num", v: Number(tok.value), id: id() };
    }
    if (tok.type === "str") {
      p++;
      return { k: "str", v: tok.value, id: id() };
    }
    if (tok.type === "color") {
      p++;
      return { k: "color", v: tok.value, id: id() };
    }
    if (tok.type === "kw" && (tok.value === "true" || tok.value === "false")) {
      p++;
      return { k: "bool", v: tok.value === "true", id: id() };
    }
    if (tok.type === "kw" && tok.value === "na") {
      p++;
      if (at("op", "(")) return callRest("na", tok);
      return { k: "na", id: id() };
    }
    if (at("op", "(")) {
      p++;
      const e = expr();
      eat("op", ")");
      return e;
    }
    if (at("op", "[")) {
      p++;
      const items: Expr[] = [];
      while (!at("op", "]")) {
        items.push(expr());
        if (at("op", ",")) p++;
      }
      eat("op", "]");
      return { k: "tuple", items, id: id() };
    }
    if (tok.type === "ident") {
      p++;
      let path = tok.value;
      while (at("op", ".") && peek(1).type === "ident") {
        p++;
        path += "." + t[p++].value;
      }
      if (/^(request|matrix|map|array)\./.test(path)) fail(`${path} is not supported yet.`, tok);
      if (at("op", "(")) return callRest(path, tok);
      return path.includes(".") ? { k: "member", path, id: id(), line: tok.line } : { k: "ident", name: path, id: id(), line: tok.line };
    }
    return fail(`Unexpected "${tok.value || tok.type}".`);
  }

  function callRest(fn: string, tok: Token): Expr {
    eat("op", "(");
    const args: Expr[] = [];
    const named: Record<string, Expr> = {};
    while (!at("op", ")")) {
      if (at("ident") && peek(1).type === "op" && peek(1).value === "=") {
        const key = eat("ident").value;
        p++;
        named[key] = expr();
      } else {
        if (Object.keys(named).length) fail("Positional arguments must come before named ones.");
        args.push(expr());
      }
      if (at("op", ",")) p++;
      else if (!at("op", ")")) fail(`Expected , or ) in the call to ${fn}.`);
    }
    eat("op", ")");
    return { k: "call", fn, args, named, id: id(), line: tok.line };
  }

  const body: Stmt[] = [];
  skipNewlines();
  while (!at("eof")) {
    if (at("dedent")) {
      p++;
      continue;
    }
    body.push(statement());
    skipNewlines();
  }
  return { body, nodes: nid };
}
