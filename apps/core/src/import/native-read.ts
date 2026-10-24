// A Claude Code or Codex session read whole, for bringing it into APX: what the owner and the engine said, the images
// either attached or made, the tools the engine ran and the pages it wrote. Read-only on the CLIs' folders.
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { isInside } from "../paths.ts";
import type { NativeEngine } from "./native-sessions.ts";

export type NativeImage = { mime: string; bytes: Buffer };
export type NativeTool = { name: string; detail: string };
/** A page the engine published as an artifact, or a document it wrote (Claude Code's Artifact and Write calls). */
export type NativeFile = { kind: "artifact" | "document"; path: string };
export type NativeItem = {
  role: "user" | "assistant";
  text: string;
  at?: string | undefined;
  images: NativeImage[];
  /** The tools the engine ran before this answer. */
  tools: NativeTool[];
  /** The artifacts and documents those tools made. */
  files: NativeFile[];
};

/** Enough of a call's input to find the files it wrote; the chat shows only its start. */
const TOOL_DETAIL = 4000;
const PAGE = /\.html?$/i;

/**
 * A session file's text. Codex compresses older rollouts (`.jsonl.zst`) while its index still names the `.jsonl`,
 * so either spelling finds the file that is there.
 */
export function sessionText(file: string): string | undefined {
  const plain = file.replace(/\.zst$/, "");
  for (const f of [file, `${plain}.zst`, plain]) {
    let buf: Buffer;
    try {
      buf = fs.readFileSync(f);
    } catch {
      continue;
    }
    return (f.endsWith(".zst") ? zlib.zstdDecompressSync(buf) : buf).toString("utf8");
  }
  return undefined;
}

/** The file a session really is on disk (see sessionText), or undefined. */
export function sessionFile(file: string): string | undefined {
  const plain = file.replace(/\.zst$/, "");
  return [file, `${plain}.zst`, plain].find((f) => fs.existsSync(f));
}

function* lines(text: string): Generator<Record<string, unknown>> {
  for (const line of text.split("\n")) {
    if (!line.trim()) continue;
    try {
      const v = JSON.parse(line) as unknown;
      if (v && typeof v === "object") yield v as Record<string, unknown>;
    } catch {}
  }
}

const obj = (v: unknown): Record<string, unknown> =>
  v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
const str = (v: unknown) => (typeof v === "string" ? v : "");

/** What the CLI itself adds around the owner's words: commands, reminders, caveats, AGENTS.md, environment. */
const wrapper = (t: string) =>
  t.startsWith("<") || t.startsWith("Caveat:") || t.startsWith("[Request interrupted") || t.startsWith("# AGENTS.md");

/** Codex puts the files the owner mentioned before their words; only the words after its marker are theirs. */
function ownWords(t: string): string {
  const at = t.indexOf("## My request:");
  return at >= 0 ? t.slice(at + "## My request:".length) : t;
}

function dataImage(url: string): NativeImage | undefined {
  const m = /^data:(image\/[a-z+.-]+);base64,(.+)$/s.exec(url);
  return m?.[1] && m[2] ? { mime: m[1], bytes: Buffer.from(m[2], "base64") } : undefined;
}

/** The text and images of a message's content (a string or parts), without the CLI's wrappers. */
function contentOf(content: unknown): { text: string; images: NativeImage[] } {
  if (typeof content === "string") return { text: wrapper(content.trim()) ? "" : ownWords(content).trim(), images: [] };
  const texts: string[] = [];
  const images: NativeImage[] = [];
  for (const raw of Array.isArray(content) ? content : []) {
    const p = obj(raw);
    const type = str(p.type);
    if (type === "text" || type === "input_text" || type === "output_text") {
      const t = str(p.text).trim();
      if (t && !wrapper(t)) texts.push(ownWords(t).trim());
    } else if (type === "input_image") {
      const img = dataImage(str(p.image_url));
      if (img) images.push(img);
    } else if (type === "image") {
      const src = obj(p.source);
      if (src.type === "base64" && str(src.data))
        images.push({ mime: str(src.media_type) || "image/png", bytes: Buffer.from(str(src.data), "base64") });
    }
  }
  return { text: texts.filter(Boolean).join("\n").trim(), images };
}

const detailOf = (v: unknown) => (typeof v === "string" ? v : JSON.stringify(v ?? "")).slice(0, TOOL_DETAIL);

/** Codex keeps the images its image_gen made in a thread under generated_images/<thread>. */
function generatedImages(codexHome: string, thread: string): Array<NativeImage & { at: string }> {
  const dir = path.join(codexHome, "generated_images", thread);
  let names: string[];
  try {
    names = fs.readdirSync(dir).filter((n) => /\.(png|jpe?g|webp)$/i.test(n));
  } catch {
    return [];
  }
  return names.flatMap((n) => {
    const file = path.join(dir, n);
    try {
      const ext = n.split(".").pop()?.toLowerCase();
      const mime = ext === "png" ? "image/png" : ext === "webp" ? "image/webp" : "image/jpeg";
      return [{ mime, bytes: fs.readFileSync(file), at: fs.statSync(file).mtime.toISOString() }];
    } catch {
      return [];
    }
  });
}

/** An Artifact publish (not its other actions) or a Markdown file written whole. */
function madeFile(tool: string, input: Record<string, unknown>): NativeFile | undefined {
  const file = str(input.file_path);
  if (!file) return undefined;
  if (tool === "Artifact" && !input.action && !input.asset && /\.html?$/i.test(file))
    return { kind: "artifact", path: file };
  // Claude Code's own memory files come in as memory notes (sessions.import's extras), not as documents.
  if (/[/\\]\.claude[/\\]projects[/\\][^/\\]+[/\\]memory[/\\]/.test(file)) return undefined;
  if (tool === "Write" && /\.(md|markdown)$/i.test(file)) return { kind: "document", path: file };
  return undefined;
}

/**
 * Every turn of a session, oldest first. Tool calls ride on the answer that follows them; Codex's own images go after
 * the turn they were made in.
 */
export function sessionItems(
  engine: NativeEngine,
  file: string,
  o: { codexHome?: string; thread?: string } = {},
): NativeItem[] {
  const text = sessionText(file);
  if (text === undefined) return [];
  const items: NativeItem[] = [];
  let tools: NativeTool[] = [];
  let files: NativeFile[] = [];
  const push = (role: NativeItem["role"], content: unknown, at: string | undefined) => {
    const c = contentOf(content);
    if (!c.text && !c.images.length) return;
    const mine = role === "assistant";
    items.push({ role, text: c.text, at, images: c.images, tools: mine ? tools : [], files: mine ? files : [] });
    if (mine) {
      tools = [];
      files = [];
    }
  };
  for (const o of lines(text)) {
    const at = str(o.timestamp) || undefined;
    if (engine === "claude") {
      if (o.isSidechain || o.isMeta || (o.type !== "user" && o.type !== "assistant")) continue;
      const content = obj(o.message).content;
      if (o.type === "assistant" && Array.isArray(content))
        for (const p of content.map(obj))
          if (p.type === "tool_use") {
            tools.push({ name: str(p.name) || "tool", detail: detailOf(p.input) });
            const f = madeFile(str(p.name), obj(p.input));
            if (f) files.push(f);
          }
      push(o.type, content, at);
      continue;
    }
    const p = obj(o.payload);
    if (o.type !== "response_item") continue;
    if (p.type === "message" && (p.role === "user" || p.role === "assistant")) push(p.role, p.content, at);
    else if (p.type === "custom_tool_call" || p.type === "function_call")
      tools.push({ name: str(p.name) || "tool", detail: detailOf(p.input ?? p.arguments) });
  }
  if (engine === "codex" && o.codexHome && o.thread) {
    for (const img of generatedImages(o.codexHome, o.thread)) {
      // After the last turn that started before the image was written.
      let i = items.length;
      while (i > 0 && (items[i - 1]?.at ?? "") > img.at) i--;
      items.splice(i, 0, { role: "assistant", text: "", at: img.at, images: [img], tools: [], files: [] });
    }
  }
  return items;
}

/**
 * The pages (HTML) a session wrote that are still in its folder: what the owner may have opened as an artifact.
 * Claude Code names the file in its Write/Edit call; Codex in an apply_patch or a shell command.
 */
export function writtenPages(items: NativeItem[], cwd: string): string[] {
  const root = path.resolve(cwd);
  const found = new Set<string>();
  // POSIX paths, and on Windows C:\… with the backslashes doubled as JSON writes them.
  for (const it of items)
    for (const t of it.tools)
      for (const m of t.detail.matchAll(/["'\s:]((?:[a-z]:[\\/]|\/|\.{0,2}[\\/]?)[\w./\\@~-]+\.html?)\b/gi)) {
        const raw = (m[1] ?? "").replace(/\\\\/g, "\\");
        if (!PAGE.test(raw)) continue;
        const abs = path.resolve(root, raw);
        if (isInside(root, abs) && fs.existsSync(abs) && fs.statSync(abs).isFile()) found.add(abs);
      }
  return [...found].sort();
}
