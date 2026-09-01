import { XMLParser } from "fast-xml-parser";

import { decodeText } from "./decode-bytes";
import { dedupeHeaders } from "./header-detect";
import { SOURCE_ERROR, SourceReadError, type SourceTable } from "./types";

const ATTR_PREFIX = "@_";

/**
 * XML statement reader. `fast-xml-parser` has no filesystem or network access
 * and, with `processEntities:false`, performs no entity substitution at all —
 * so external-entity (XXE) and billion-laughs payloads are inert. External DTDs
 * are never resolved.
 *
 * After parsing we walk the tree for the largest array of "row-like" objects
 * (repeated `<Trade>` / `<Deal>` / `<Position>` / `<Row>` elements), then
 * flatten each row's attributes and scalar children into a `Record<string,
 * string>`.
 */
export function readXml(bytes: Uint8Array): SourceTable[] {
  const xml = decodeText(bytes);
  if (xml.trim() === "") throw new SourceReadError(SOURCE_ERROR.MALFORMED);

  const parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: ATTR_PREFIX,
    processEntities: false, // XXE / entity-expansion safe
    htmlEntities: false,
    parseTagValue: false,
    parseAttributeValue: false,
    trimValues: true,
    ignoreDeclaration: true,
    ignorePiTags: true,
    allowBooleanAttributes: true,
  });

  let tree: unknown;
  try {
    tree = parser.parse(xml);
  } catch {
    throw new SourceReadError(SOURCE_ERROR.MALFORMED);
  }

  const candidates: { path: string; records: Record<string, unknown>[] }[] = [];
  collectRecordArrays(tree, "", candidates, 0);

  const best = candidates
    .map((c) => ({ ...c, score: scoreCandidate(c.records) }))
    .sort((a, b) => b.score - a.score)[0];

  if (!best || best.records.length === 0) throw new SourceReadError(SOURCE_ERROR.NO_TRADING_TABLE);

  const flatRows = best.records.map(flattenRecord);
  const headerOrder: string[] = [];
  for (const row of flatRows) {
    for (const k of Object.keys(row)) if (!headerOrder.includes(k)) headerOrder.push(k);
  }
  if (headerOrder.length === 0) throw new SourceReadError(SOURCE_ERROR.NO_TRADING_TABLE);

  const headers = dedupeHeaders(headerOrder);
  const rows = flatRows.map((row) => {
    const rec: Record<string, string> = {};
    headerOrder.forEach((k, i) => {
      rec[headers[i]] = row[k] ?? "";
    });
    return rec;
  });

  return [
    {
      id: "x0",
      name: best.path || "XML statement",
      headers,
      rows,
      meta: { sheetName: best.path || undefined },
    },
  ];
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v != null && !Array.isArray(v);
}

function isScalar(v: unknown): boolean {
  return v == null || typeof v === "string" || typeof v === "number" || typeof v === "boolean";
}

/** Depth-first search for `key: [ {...}, {...} ]` shapes, plus the single-row
 *  `key: { ...scalars... }` case that XML collapses when there's one element. */
function collectRecordArrays(
  node: unknown,
  path: string,
  out: { path: string; records: Record<string, unknown>[] }[],
  depth: number,
): void {
  if (depth > 12 || !isPlainObject(node)) return;

  for (const [key, value] of Object.entries(node)) {
    if (key.startsWith(ATTR_PREFIX)) continue;
    const childPath = path ? `${path}.${key}` : key;

    if (Array.isArray(value)) {
      const objs = value.filter(isPlainObject) as Record<string, unknown>[];
      if (objs.length >= 1) out.push({ path: childPath, records: objs });
      for (const item of objs) collectRecordArrays(item, childPath, out, depth + 1);
    } else if (isPlainObject(value)) {
      const scalarChildren = Object.entries(value).filter(([, v]) => isScalar(v) || Array.isArray(v));
      const hasScalarLeaves = Object.entries(value).some(
        ([k, v]) => (k.startsWith(ATTR_PREFIX) || isScalar(v)) && !Array.isArray(v),
      );
      if (hasScalarLeaves && scalarChildren.length >= 2 && /trade|deal|position|order|row|transaction|entry/i.test(key)) {
        out.push({ path: childPath, records: [value] });
      }
      collectRecordArrays(value, childPath, out, depth + 1);
    }
  }
}

function scoreCandidate(records: Record<string, unknown>[]): number {
  if (records.length === 0) return -1;
  const sample = records[0];
  const scalarKeys = Object.entries(sample).filter(
    ([k, v]) => k.startsWith(ATTR_PREFIX) || isScalar(v),
  ).length;
  return records.length * 2 + scalarKeys;
}

function flattenRecord(rec: Record<string, unknown>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(rec)) {
    const name = key.startsWith(ATTR_PREFIX) ? key.slice(ATTR_PREFIX.length) : key;
    if (isScalar(value)) {
      if (value != null && value !== "") out[name] = String(value);
    } else if (isPlainObject(value)) {
      // A child element with only a "#text" value, or nested attributes.
      const text = (value as Record<string, unknown>)["#text"];
      if (isScalar(text) && text != null && text !== "") out[name] = String(text);
    }
  }
  return out;
}
