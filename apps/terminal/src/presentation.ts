import fs from "node:fs";
import path from "node:path";
import { stripVTControlCharacters } from "node:util";
import { inflateSync } from "node:zlib";
import { apxHome } from "./commands/local.ts";

export type TerminalTheme = { name: string; blob: string };
const DEFAULT_THEME: TerminalTheme = { name: "APX", blob: "ovni" };

/** Outside names and errors cannot write escape sequences or terminal control codes. */
export const clean = (s: string) => s.replace(/[\p{Cc}\p{Cf}]/gu, " ");

export function cells(text: string): number {
  return [...stripVTControlCharacters(text)].reduce((n, c) => {
    if (/\p{Mark}/u.test(c)) return n;
    const cp = c.codePointAt(0) ?? 0;
    const wide =
      /\p{Extended_Pictographic}/u.test(c) ||
      (cp >= 0x1100 && cp <= 0x115f) ||
      (cp >= 0x2e80 && cp <= 0xa4cf) ||
      (cp >= 0xac00 && cp <= 0xd7af) ||
      (cp >= 0xf900 && cp <= 0xfaff) ||
      (cp >= 0xff01 && cp <= 0xff60);
    return n + (wide ? 2 : 1);
  }, 0);
}

function wrap(text: string, width: number): string[] {
  const out: string[] = [];
  for (const line of text.split("\n")) {
    let row = "";
    for (const word of clean(line).split(" ")) {
      if (row && cells(`${row} ${word}`) > width) {
        out.push(row);
        row = "";
      }
      for (const c of (row ? " " : "") + word) {
        if (cells(row + c) > width) {
          out.push(row);
          row = "";
        }
        row += c;
      }
    }
    out.push(row);
  }
  return out;
}
const pad = (text: string, width: number) => text + " ".repeat(Math.max(0, width - cells(text)));

type Blob = { rows: string[]; color: number[]; pixels: string };
function blob(name = "ovni"): Blob | undefined {
  const atlas = JSON.parse(fs.readFileSync(new URL("./blobs.json", import.meta.url), "utf8")) as Record<string, Blob>;
  return atlas[name] ?? atlas.ovni;
}
export function portrait(name?: string, color = false): string[] {
  const face = blob(name);
  if (!face) return [];
  if (!color) return face.rows;
  const bytes = inflateSync(Buffer.from(face.pixels, "base64"));
  const rows: string[] = [];
  const rgb = (i: number) => `${bytes[i]};${bytes[i + 1]};${bytes[i + 2]}`;
  for (let y = 0; y < 26; y += 2) {
    let row = "";
    for (let x = 0; x < 26; x++) {
      const top = (y * 26 + x) * 4;
      const bottom = ((y + 1) * 26 + x) * 4;
      const a = (bytes[top + 3] ?? 0) > 90;
      const b = (bytes[bottom + 3] ?? 0) > 90;
      row +=
        !a && !b
          ? " "
          : a && b
            ? `\u001b[38;2;${rgb(top)}m\u001b[48;2;${rgb(bottom)}m▀\u001b[0m`
            : `\u001b[38;2;${rgb(a ? top : bottom)}m${a ? "▀" : "▄"}\u001b[0m`;
    }
    rows.push(row);
  }
  return rows;
}
export function portraitColor(name?: string): number[] {
  const rgb = blob(name)?.color ?? [58, 231, 176];
  const scale = Math.max(1, 190 / Math.max(...rgb, 1));
  return rgb.map((n) => Math.min(255, Math.round(n * scale)));
}

/** A pure renderer: scripts get plain text, while interactive terminals get the blob's own accent. */
export function card(
  title: string,
  lines: string[],
  columns = process.stdout.columns || 94,
  accent?: number[],
  theme: TerminalTheme = DEFAULT_THEME,
  color = Boolean(process.stdout.isTTY && process.env.NO_COLOR === undefined && process.env.TERM !== "dumb"),
): string {
  const width = Math.max(12, Math.min(100, (columns || 94) - 2));
  const inner = width - 4;
  const rgb = accent ?? portraitColor(theme.blob);
  const tint = (s: string) => (color ? `\u001b[38;2;${rgb.join(";")}m${s}\u001b[0m` : s);
  const dim = (s: string) => (color ? `\u001b[2m${s}\u001b[0m` : s);
  const bold = (s: string) => (color ? `\u001b[1m${s}\u001b[0m` : s);
  const art = [...portrait(theme.blob, color), "", dim("Your crew, on your machine")];
  const heading = "APX / Your crew, at a glance";
  const option = `Seeing ${clean(title)}`;
  const output: string[] = [];
  if (width >= 74) {
    const left = 26;
    const right = inner - left - 4;
    const headers = wrap(heading, right);
    const labels = wrap(option, right);
    const details = [...headers, ...labels, "", ...lines.flatMap((s) => wrap(s, right))];
    for (let i = 0; i < Math.max(art.length, details.length); i++) {
      const drawing = pad(art[i] ?? "", left);
      const detail = pad(details[i] ?? "", right);
      const styled =
        i < headers.length ? bold(tint(detail)) : i < headers.length + labels.length ? bold(detail) : detail;
      output.push(`  ${drawing}    ${styled}  `);
    }
  } else {
    if (width >= 34) {
      const offset = Math.max(0, Math.floor((inner - 26) / 2));
      for (const row of art) output.push(`  ${pad(" ".repeat(offset) + row, inner)}  `);
      output.push(" ".repeat(width));
    }
    for (const s of wrap(heading, inner)) output.push(`  ${bold(tint(pad(s, inner)))}  `);
    for (const s of wrap(option, inner)) output.push(`  ${bold(pad(s, inner))}  `);
    for (const row of lines.flatMap((s) => wrap(s, inner))) output.push(`  ${pad(row, inner)}  `);
  }
  return output.join("\n");
}

export function readTheme(home: string): TerminalTheme {
  try {
    const t: unknown = JSON.parse(fs.readFileSync(path.join(home, "terminal-theme.json"), "utf8"));
    if (
      t &&
      typeof t === "object" &&
      "name" in t &&
      "blob" in t &&
      typeof t.name === "string" &&
      typeof t.blob === "string"
    )
      return { name: clean(t.name).slice(0, 80), blob: t.blob.slice(0, 40) };
  } catch {}
  return DEFAULT_THEME;
}

/** Only display identity is cached; errors and help can keep the chosen face when the core is offline. */
export function rememberTheme(home: string, theme: TerminalTheme): void {
  try {
    const file = path.join(home, "terminal-theme.json");
    const value = JSON.stringify({ name: clean(theme.name).slice(0, 80), blob: theme.blob.slice(0, 40) });
    if (fs.existsSync(file) && fs.readFileSync(file, "utf8") === value) return;
    fs.mkdirSync(home, { recursive: true });
    fs.writeFileSync(file, value, { mode: 0o600 });
  } catch {
    /* Display remains usable when the cache is read-only. */
  }
}

export function themedCard(title: string, lines: string[], columns?: number, accent?: number[]): string {
  return card(title, lines, columns, accent, readTheme(apxHome()));
}

export const duration = (seconds: number) => {
  const n = Math.floor(seconds);
  return n < 60
    ? `${n}s`
    : n < 3600
      ? `${Math.floor(n / 60)}m ${n % 60}s`
      : `${Math.floor(n / 3600)}h ${Math.floor((n % 3600) / 60)}m`;
};
