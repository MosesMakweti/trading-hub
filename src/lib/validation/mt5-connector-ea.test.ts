import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { mt5DealWireSchema, mt5OrderWireSchema, mt5OpenPositionSchema, mt5PairRequestSchema, mt5SymbolSpecSchema } from "@/lib/validation/mt5-connector";

/**
 * Static guarantees about extensions/mt5/TraditoriumConnector.mq5. MetaEditor
 * isn't available in CI, so these checks keep the EA read-only and keep its
 * wire format in step with the server's Zod schemas.
 */

const source = readFileSync(path.resolve(__dirname, "../../../extensions/mt5/TraditoriumConnector.mq5"), "utf8");
// Strip comments so documentation that mentions forbidden calls can't hide a real one.
// (`://` inside URL string literals is not a comment.)
const code = source.replace(/(^|[^:])\/\/.*$/gm, "$1").replace(/\/\*[\s\S]*?\*\//g, "");

function functionBody(name: string): string {
  const start = code.indexOf(`string ${name}(`);
  expect(start).toBeGreaterThan(-1);
  const end = code.indexOf("\n  }\n", start);
  return code.slice(start, end);
}

function sentKeys(body: string): string[] {
  return [...body.matchAll(/\\"([A-Za-z]+)\\":/g)].map((m) => m[1]!);
}

describe("TraditoriumConnector.mq5 — read-only", () => {
  it.each([
    "OrderSend",
    "OrderSendAsync",
    "OrderCheck",
    "PositionClose",
    "PositionModify",
    "PositionOpen",
    "OrderModify",
    "OrderDelete",
    "CTrade",
    "Trade.mqh",
    "TRADE_ACTION_",
  ])("never references %s", (forbidden) => {
    expect(code).not.toContain(forbidden);
  });

  it("never handles passwords and only talks HTTPS (http only for localhost)", () => {
    expect(code.toLowerCase()).not.toContain("password");
    expect(code).toContain('StringFind(u, "https://") == 0');
    expect(code).toContain("WebRequest(");
  });

  it("does no network I/O inside OnTradeTransaction", () => {
    const start = code.indexOf("void OnTradeTransaction(");
    const body = code.slice(start, code.indexOf("void OnTimer(", start));
    expect(body).not.toContain("WebRequest");
    expect(body).not.toContain("Post(");
  });
});

describe("TraditoriumConnector.mq5 — wire format matches the server schemas", () => {
  it("deal fields", () => {
    const keys = sentKeys(functionBody("DealJson"));
    expect(keys.length).toBeGreaterThan(10);
    for (const k of keys) expect(Object.keys(mt5DealWireSchema.shape)).toContain(k);
  });

  it("order fields", () => {
    for (const k of sentKeys(functionBody("OrderJson"))) expect(Object.keys(mt5OrderWireSchema.shape)).toContain(k);
  });

  it("pair, open-position and symbol fields", () => {
    const pairKeys = [...Object.keys(mt5PairRequestSchema.shape), ...Object.keys(mt5PairRequestSchema.shape.terminal.shape)];
    const doPair = code.slice(code.indexOf("void DoPair()"), code.indexOf("void DoHeartbeat()"));
    for (const k of sentKeys(doPair)) expect(pairKeys).toContain(k);

    const heartbeat = code.slice(code.indexOf("void DoHeartbeat()"), code.indexOf("bool SelectAllHistory("));
    const positionKeys = sentKeys(heartbeat.slice(heartbeat.indexOf("positionId")- 4));
    const allowed = [...Object.keys(mt5OpenPositionSchema.shape), "account", "eaVersion", "build", "gmtOffsetSeconds", "serverTimeMsc", "snapshot", "openPositions", "login", "server"];
    for (const k of positionKeys) expect(allowed).toContain(k);

    const symbols = code.slice(code.indexOf("void DoSymbols()"), code.indexOf("bool RefreshIdentity()"));
    for (const k of sentKeys(symbols).filter((k) => !["account", "specs"].includes(k))) expect(Object.keys(mt5SymbolSpecSchema.shape)).toContain(k);
  });

  it("sends tickets and decimals as strings", () => {
    expect(code).toMatch(/string JTicket\(ulong t\)\s*\{ return "\\"" \+ StringFormat\("%I64u", t\) \+ "\\""; \}/);
    expect(code).toMatch(/string JDec\(double v, int digits\) \{ return "\\"" \+ DoubleToString\(v, digits\) \+ "\\""; \}/);
  });
});
