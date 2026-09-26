/**
 * Key-order-insensitive JSON serialization. Postgres `jsonb` does not preserve
 * object key order, so comparing a stored JSON value with a freshly built one
 * via plain JSON.stringify reports spurious differences. Compare these instead.
 */
export function canonicalJson(value: unknown, omitTopLevelKeys: ReadonlySet<string> = new Set()): string {
  return JSON.stringify(normalize(value, omitTopLevelKeys, true));
}

function normalize(value: unknown, omit: ReadonlySet<string>, topLevel: boolean): unknown {
  if (Array.isArray(value)) return value.map((v) => normalize(v, omit, false));
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(value as Record<string, unknown>).sort()) {
      if (topLevel && omit.has(key)) continue;
      const v = (value as Record<string, unknown>)[key];
      if (v === undefined) continue;
      out[key] = normalize(v, omit, false);
    }
    return out;
  }
  return value;
}
