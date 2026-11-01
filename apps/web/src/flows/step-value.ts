// A step's value as a run's panel shows it: JSON that reads as fields, or text as it is. No .tsx imports: tested alone.

export type Json = null | boolean | number | string | Json[] | { [key: string]: Json };
export type Fields = Json[] | { [key: string]: Json };

/** The object or list a step's text holds; undefined for plain text or a lone value, which read best as they are. */
export function fieldsOf(text: string): Fields | undefined {
  const t = text.trim();
  if (!t.startsWith("{") && !t.startsWith("[")) return undefined;
  try {
    const v = JSON.parse(t) as Json;
    return v !== null && typeof v === "object" ? v : undefined;
  } catch {
    return undefined;
  }
}

/** Text long or broken into lines: it gets a block of its own under its name, with its line breaks kept. */
export const isLong = (s: string) => s.length > 80 || s.includes("\n");

/** The columns a few rows show: the table's own, else every field its rows have, in the order first seen. */
export function rowColumns(columns: readonly string[], rows: readonly { value: unknown }[]): string[] {
  if (columns.length) return [...columns];
  const seen = new Set<string>();
  for (const { value } of rows)
    if (value !== null && typeof value === "object" && !Array.isArray(value))
      for (const k of Object.keys(value)) seen.add(k);
    else if (value !== undefined) seen.add("value");
  return [...seen];
}

/** JSON with every object's keys sorted: the same content reads the same whatever order it was written in. */
const canonical = (v: Json): string =>
  v === null || typeof v !== "object"
    ? JSON.stringify(v)
    : Array.isArray(v)
      ? `[${v.map(canonical).join(",")}]`
      : `{${Object.keys(v)
          .sort()
          .map((k) => `${JSON.stringify(k)}:${canonical(v[k] as Json)}`)
          .join(",")}}`;

/** Where a part sits in a value, as `repeats` names it. */
export const partKey = (path: readonly string[]) => JSON.stringify(path);

/**
 * The parts that only repeat what shows above them, in reading order: a table read gives its row as columns, as `row`
 * and under its key in `rows`, the same cells three times. An object's plain fields count as shown, as one row.
 */
export function repeats(value: Fields): Set<string> {
  const seen = new Set<string>();
  const out = new Set<string>();
  const walk = (v: Fields, path: string[]) => {
    const entries: [string, Json][] = Array.isArray(v) ? v.map((x, i) => [String(i + 1), x]) : Object.entries(v);
    const plain = entries.filter(([, x]) => x === null || typeof x !== "object");
    if (!Array.isArray(v) && plain.length) seen.add(canonical(Object.fromEntries(plain)));
    for (const [k, x] of entries) {
      if (x === null || typeof x !== "object") continue;
      const at = [...path, k];
      const content = canonical(x);
      if (content === "{}" || content === "[]") continue;
      if (seen.has(content)) out.add(partKey(at));
      else {
        seen.add(content);
        walk(x, at);
      }
    }
  };
  walk(value, []);
  return out;
}
