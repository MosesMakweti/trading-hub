import fs from "node:fs";
import path from "node:path";

import ExcelJS from "exceljs";
import { describe, expect, it } from "vitest";

import { detectPlatform, getAdapter } from "../adapter-registry";
import { readSource } from "./read-source";
import { rankTables } from "./pick-table";
import type { SourceReadOptions } from "./types";

const OPTS: SourceReadOptions = { fileName: "f", mimeType: null, maxTables: 50 };
const bytes = (s: string) => new Uint8Array(Buffer.from(s, "utf8"));
const opts = (over: Partial<SourceReadOptions>): SourceReadOptions => ({ ...OPTS, ...over });

describe("readSource — delimited", () => {
  it("reads a TSV, skipping a decorative preamble", async () => {
    const tsv = ["Account Statement", "Generated 2026-06-20", "", "Symbol\tSide\tQty\tPrice\tTime", "EURUSD\tBuy\t1\t1.1\t2026-06-15 09:00:00"].join(
      "\n",
    );
    const doc = await readSource(bytes(tsv), opts({ fileName: "s.tsv" }));
    expect(doc.format).toBe("TSV");
    expect(doc.tables).toHaveLength(1);
    expect(doc.tables[0].headers).toEqual(["Symbol", "Side", "Qty", "Price", "Time"]);
    expect(doc.tables[0].rows[0]).toMatchObject({ Symbol: "EURUSD", Side: "Buy", Qty: "1" });
  });

  it("reads a semicolon-delimited broker export", async () => {
    const doc = await readSource(bytes("Symbol;Side;Qty;Price;Time\nGBPUSD;Sell;2;1.27;2026-06-15 10:00:00\n"), opts({ fileName: "b.csv" }));
    expect(doc.tables[0].rows[0]).toMatchObject({ Symbol: "GBPUSD", Side: "Sell" });
  });
});

describe("readSource — HTML statements", () => {
  const MT4 = `<html><head><style>x{}</style><script>fetch('https://evil.example')</script></head><body>
    <h2>Detailed Statement</h2>
    <table>
      <tr><td colspan="14">Closed Transactions</td></tr>
      <tr><td>Ticket</td><td>Open Time</td><td>Type</td><td>Size</td><td>Item</td><td>Price</td><td>S / L</td><td>T / P</td><td>Close Time</td><td>Price</td><td>Commission</td><td>Taxes</td><td>Swap</td><td>Profit</td></tr>
      <tr><td>111</td><td>2026.06.15 09:00:00</td><td>buy</td><td>0.10</td><td>EURUSD</td><td>1.10500</td><td>0</td><td>0</td><td>2026.06.15 12:00:00</td><td>1.10800</td><td>-1.00</td><td>0</td><td>-0.20</td><td>30.00</td></tr>
      <tr><td>112</td><td>2026.06.16 08:00:00</td><td>balance</td><td>0</td><td></td><td>0</td><td>0</td><td>0</td><td></td><td>0</td><td>0</td><td>0</td><td>0</td><td>-500.00</td></tr>
    </table></body></html>`;

  it("extracts the Closed Transactions section as a table, ignoring <script>/<style>", async () => {
    const doc = await readSource(bytes(MT4), opts({ fileName: "statement.htm" }));
    expect(doc.format).toBe("HTML");
    const t = doc.tables.find((x) => /closed transactions/i.test(x.name)) ?? doc.tables[0];
    expect(t.headers).toContain("Ticket");
    expect(t.headers).toContain("Item");
    // The two "Price" columns are disambiguated.
    expect(t.headers.filter((h) => /^price/i.test(h)).length).toBe(2);
    expect(t.rows.length).toBe(2);
    const serialized = JSON.stringify(doc);
    expect(serialized).not.toContain("evil.example");
    expect(serialized).not.toContain("fetch(");
  });

  it("throws 'No recognizable trading table found.' for a page with no <table>", async () => {
    await expect(readSource(bytes("<html><body><p>no tables here</p></body></html>"), opts({ fileName: "x.html" }))).rejects.toThrow(
      "No recognizable trading table found.",
    );
  });

  it("ignores an onerror handler / external resources but still reads the data", async () => {
    const evil = `<html><body><img src="x" onerror="fetch('https://evil.example')">
      <table><tr><td>Symbol</td><td>Side</td><td>Qty</td><td>Price</td><td>Time</td></tr>
      <tr><td>EURUSD</td><td>buy</td><td>1</td><td>1.1</td><td>2026-06-15 09:00:00</td></tr></table></body></html>`;
    const doc = await readSource(bytes(evil), opts({ fileName: "e.html" }));
    expect(doc.tables[0].rows[0]).toMatchObject({ Symbol: "EURUSD" });
    expect(JSON.stringify(doc)).not.toContain("onerror");
  });
});

describe("readSource — XML statements", () => {
  it("flattens repeated <Trade> elements into rows", async () => {
    const xml = `<?xml version="1.0"?><Statement><Trades>
      <Trade Symbol="EURUSD" Direction="Buy" Volume="1" Price="1.1050" Time="2026-06-15 09:00:00" DealId="900"/>
      <Trade Symbol="EURUSD" Direction="Sell" Volume="1" Price="1.1080" Time="2026-06-15 12:00:00" DealId="901"/>
    </Trades></Statement>`;
    const doc = await readSource(bytes(xml), opts({ fileName: "s.xml" }));
    expect(doc.format).toBe("XML");
    expect(doc.tables[0].rows).toHaveLength(2);
    expect(doc.tables[0].rows[0]).toMatchObject({ Symbol: "EURUSD", Direction: "Buy", DealId: "900" });
  });

  it("does not expand XML entities (XXE / billion-laughs are inert)", async () => {
    const xml = `<?xml version="1.0"?>
      <!DOCTYPE root [ <!ENTITY leak "SECRET_LEAKED_VALUE"> ]>
      <Trades>
        <Trade Symbol="&leak;" Direction="Buy" Volume="1" Price="1.1" Time="2026-06-15 09:00:00" DealId="1"/>
      </Trades>`;
    const doc = await readSource(bytes(xml), opts({ fileName: "x.xml" }));
    expect(JSON.stringify(doc)).not.toContain("SECRET_LEAKED_VALUE");
  });

  it("throws for junk that isn't really XML rows", async () => {
    await expect(readSource(bytes("<?xml version=\"1.0\"?><empty/>"), opts({ fileName: "j.xml" }))).rejects.toThrow(
      "No recognizable trading table found.",
    );
  });
});

describe("readSource — workbooks", () => {
  async function workbook(build: (wb: ExcelJS.Workbook) => void): Promise<Uint8Array> {
    const wb = new ExcelJS.Workbook();
    build(wb);
    return new Uint8Array(Buffer.from(await wb.xlsx.writeBuffer()));
  }

  it("reads every sheet, drops title/blank rows, detects the header row, and uses a formula's cached result", async () => {
    const buf = await workbook((wb) => {
      const ws = wb.addWorksheet("Deals");
      ws.addRow(["Broker XYZ — Trade History"]);
      ws.addRow([]);
      ws.addRow(["Symbol", "Side", "Qty", "Price", "Time", "Profit"]);
      ws.addRow(["EURUSD", "buy", 1, 1.105, new Date(Date.UTC(2026, 5, 15, 9, 0, 0)), { formula: "1+1", result: 30 }]);
      const s = wb.addWorksheet("Summary");
      s.addRow(["Metric", "Value"]);
      s.addRow(["Total", 30]);
    });

    const doc = await readSource(buf, opts({ fileName: "book.xlsx" }));
    expect(doc.format).toBe("XLSX");
    expect(doc.tables.map((t) => t.name).sort()).toEqual(["Deals", "Summary"]);

    const deals = doc.tables.find((t) => t.name === "Deals")!;
    expect(deals.headers).toEqual(["Symbol", "Side", "Qty", "Price", "Time", "Profit"]);
    expect(deals.rows).toHaveLength(1);
    expect(deals.rows[0].Symbol).toBe("EURUSD");
    expect(deals.rows[0].Profit).toBe("30"); // cached formula result, not evaluated
    expect(deals.rows[0].Time).toMatch(/^2026-06-15 09:00:00$/);
  });

  it("throws 'Workbook contains no usable sheets.' for an empty workbook", async () => {
    const buf = await workbook((wb) => {
      wb.addWorksheet("Sheet1");
    });
    await expect(readSource(buf, opts({ fileName: "empty.xlsx" }))).rejects.toThrow("Workbook contains no usable sheets.");
  });
});

describe("readSource — non-UTF-8 encodings", () => {
  const MT5_MINI = `<html><head><script>x()</script></head><body>
    <table>
      <tr><td colspan="15"><b>Deals</b></td></tr>
      <tr><td>Time</td><td>Deal</td><td>Symbol</td><td>Type</td><td>Direction</td><td>Volume</td><td>Price</td><td>Order</td><td class="hidden">Cost</td><td>Commission</td><td>Fee</td><td>Swap</td><td>Profit</td><td>Balance</td><td>Comment</td></tr>
      <tr><td>2026.07.17 10:15:00</td><td>37122749</td><td></td><td>balance</td><td></td><td></td><td></td><td></td><td class="hidden"></td><td>0.00</td><td>0.00</td><td>0.00</td><td>5&nbsp;000.00</td><td>5&nbsp;000.00</td><td>Initial deposit</td></tr>
      <tr><td>2026.07.17 17:07:21</td><td>37652106</td><td>XAUUSD</td><td>buy</td><td>in</td><td>0.01</td><td>3998.67</td><td>34142031</td><td class="hidden"></td><td>-0.05</td><td>0.00</td><td>0.00</td><td>0.00</td><td>4&nbsp;999.95</td><td></td></tr>
      <tr><td>2026.07.17 17:07:31</td><td>37652190</td><td>XAUUSD</td><td>sell</td><td>out</td><td>0.01</td><td>3999.59</td><td>34142255</td><td class="hidden"></td><td>-0.05</td><td>0.00</td><td>0.00</td><td>0.92</td><td>5&nbsp;000.82</td><td></td></tr>
    </table></body></html>`;

  function utf16le(str: string, bom: boolean): Uint8Array {
    const body = Buffer.from(str, "utf16le");
    return new Uint8Array(bom ? Buffer.concat([Buffer.from([0xff, 0xfe]), body]) : body);
  }

  it("reads a UTF-16LE-with-BOM MT5 HTML report (no NUL corruption, Deals table found)", async () => {
    const doc = await readSource(utf16le(MT5_MINI, true), opts({ fileName: "ReportHistory.html", mimeType: "text/html" }));
    expect(doc.format).toBe("HTML");
    const deals = doc.tables.find((t) => /deals/i.test(t.name))!;
    expect(deals).toBeTruthy();
    expect(deals.headers).toEqual([
      "Time", "Deal", "Symbol", "Type", "Direction", "Volume", "Price", "Order", "Cost", "Commission", "Fee", "Swap", "Profit", "Balance", "Comment",
    ]);
    expect(deals.rows).toHaveLength(3);
    expect(JSON.stringify(doc)).not.toContain("\\u0000");
    // "5 000.00" spaced-thousands normalized to a plain space
    expect(deals.rows[0].Profit).toBe("5 000.00");
  });

  it("reads a BOM-less UTF-16LE delimited export", async () => {
    const tsv = "Symbol\tSide\tQty\tPrice\tTime\r\nXAUUSD\tBuy\t0.01\t3998.67\t2026.07.17 17:07:21\r\n";
    const doc = await readSource(utf16le(tsv, false), opts({ fileName: "hist.txt", mimeType: "" }));
    expect(doc.tables[0].rows[0]).toMatchObject({ Symbol: "XAUUSD", Side: "Buy", Qty: "0.01" });
  });
});

describe("readSource — real MetaTrader 5 UTF-16LE fixture (regression)", () => {
  const fixture = path.join(__dirname, "../__fixtures__/mt5-report-utf16le.html");

  it("decodes, finds the Deals table, and parses it with the MT5 adapter", async () => {
    const bytes = new Uint8Array(fs.readFileSync(fixture));
    const doc = await readSource(bytes, opts({ fileName: "ReportHistory-20400815.html", mimeType: "text/html" }));

    expect(doc.format).toBe("HTML");
    // The layout table splits into its sections.
    const names = doc.tables.map((t) => t.name);
    expect(names).toEqual(expect.arrayContaining(["Positions", "Orders", "Deals"]));

    // Auto-selection lands on Deals, not Positions/Orders.
    const ranked = rankTables(doc.tables);
    expect(ranked[0].name).toBe("Deals");

    const deals = doc.tables.find((t) => t.name === "Deals")!;
    expect(deals.headers).toEqual(expect.arrayContaining(["Time", "Deal", "Symbol", "Type", "Direction", "Volume", "Price", "Balance"]));

    // Not misdetected as some other platform.
    expect(detectPlatform(deals.headers, deals.rows.slice(0, 20), "x.html")[0].platform).toBe("MT5");

    const parsed = getAdapter("MT5").parse(deals.rows, deals.headers, { timezone: "Etc/UTC" });
    expect(parsed.executions.length).toBeGreaterThan(100); // ~131 real fills
    // Initial deposit + 2 payouts land as balance transactions.
    expect(parsed.transactions.length).toBe(3);
    expect(parsed.transactions.some((t) => t.amount === "5000")).toBe(true);
    expect(parsed.transactions.filter((t) => t.amount.startsWith("-")).length).toBe(2);
    // Spaced thousands parsed.
    const bal = parsed.transactions.find((t) => t.amount === "5000")!;
    expect(bal.rawType.toLowerCase()).toBe("balance");
  });
});

describe("readSource — malformed / empty", () => {
  it("rejects an empty upload", async () => {
    await expect(readSource(new Uint8Array(), OPTS)).rejects.toThrow("File is malformed or could not be read.");
  });

  it("rejects binary junk that matches no known format", async () => {
    await expect(readSource(new Uint8Array([0x00, 0x01, 0x02, 0x03, 0x00, 0xff]), OPTS)).rejects.toThrow();
  });
});
