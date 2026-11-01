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
