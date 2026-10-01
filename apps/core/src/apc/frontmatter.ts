// Frontmatter of APC files: flat `key: value` (what APX writes), plus what other tools write and we must read —
// quoted values, block scalars (`|`, `>`), YAML lists (`- item`) and nested maps flattened to dotted keys.
// Not a YAML library on purpose: the format stays predictable for the models that read these files too.

export type Fields = Record<string, string | string[]>;

const KEY_VALUE = /^([a-zA-Z_][a-zA-Z0-9_.-]*)\s*:\s*(.*)$/;
const BLOCK = /^([|>])[+-]?\d*$/;

const unquote = (v: string) => {
  const t = v.trim();
  return t.length >= 2 && ((t.startsWith('"') && t.endsWith('"')) || (t.startsWith("'") && t.endsWith("'")))
    ? t.slice(1, -1)
    : t;
};
const indent = (l: string) => l.match(/^[ \t]*/)?.[0].length ?? 0;

/** Splits a file into its frontmatter fields and its body. A file without frontmatter is all body. */
export function parseFrontmatter(text: string): { fields: Fields; body: string } {
  const src = text.replace(/\r\n/g, "\n");
  if (!src.startsWith("---\n")) return { fields: {}, body: src.trim() };
  const end = src.indexOf("\n---", 4);
  if (end < 0) return { fields: {}, body: src.trim() };
  const lines = src.slice(4, end).split("\n");
  const body = src.slice(src.indexOf("\n", end + 1) + 1).trim();
  return { fields: parseLines(lines, ""), body };
}

function parseLines(lines: string[], prefix: string): Fields {
  const out: Fields = {};
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? "";
    const m = KEY_VALUE.exec(line.trim());
    if (!m || indent(line) > 0) continue;
    const key = `${prefix}${m[1]}`;
    const value = m[2] ?? "";
    // The lines that belong to this key: everything indented deeper (and blank lines inside).
    const child: string[] = [];
    while (i + 1 < lines.length && (indent(lines[i + 1] ?? "") > 0 || (lines[i + 1] ?? "").trim() === "")) {
      child.push(lines[++i] ?? "");
    }
    while (child.length && (child.at(-1) ?? "").trim() === "") child.pop();
    if (BLOCK.test(value.trim())) {
      const base = Math.min(...child.filter((l) => l.trim()).map(indent));
      const text = child.map((l) => l.slice(base));
      out[key] = value.trim().startsWith(">") ? text.join(" ").replace(/ {2,}/g, " ").trim() : text.join("\n").trim();
    } else if (value.trim() === "" && child.some((l) => l.trim().startsWith("- "))) {
      out[key] = child.filter((l) => l.trim().startsWith("- ")).map((l) => unquote(l.trim().slice(2)));
    } else if (value.trim() === "" && child.length) {
      const base = Math.min(...child.filter((l) => l.trim()).map(indent));
      Object.assign(
        out,
        parseLines(
          child.map((l) => l.slice(base)),
          `${key}.`,
        ),
      );
    } else {
      out[key] = unquote(value);
    }
  }
  return out;
}

/** A field as a list: YAML list, or comma separated. */
export function listField(v: string | string[] | undefined): string[] {
  if (Array.isArray(v)) return v.map((s) => s.trim()).filter(Boolean);
  return (v ?? "")
    .replace(/^\[|\]$/g, "")
    .split(",")
    .map((s) => unquote(s))
    .filter(Boolean);
}

export const textField = (v: string | string[] | undefined): string | undefined =>
  v === undefined ? undefined : Array.isArray(v) ? v.join(", ") : v || undefined;
