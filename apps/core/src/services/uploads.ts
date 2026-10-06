// Files the owner attaches in the composer. Images are kept for models that can look at them; text files are read
// into the turn (capped, as outside content); other files can be copied into the turn work folder.
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { UPLOAD_LIMITS } from "@apx/protocol";
import type { MediaRecord } from "../domain/media.ts";
import type { Store } from "../domain/store.ts";

const IMAGES: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
  "image/gif": "gif",
};
/** Text the agent can read as is. */
const TEXT = /^(text\/[a-z0-9.+-]+|application\/(json|xml|x-yaml|yaml|csv|x-ndjson|javascript|typescript|x-sh))$/;
/** Binary documents kept for download and inspection with tools in the work folder. */
const OTHER: Record<string, string> = {
  "application/pdf": "pdf",
  "application/octet-stream": "bin",
  "application/zip": "zip",
  "application/msword": "doc",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "docx",
  "application/vnd.ms-excel": "xls",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": "xlsx",
};

/** The first bytes of each image type. */
function looksLike(mime: string, b: Buffer): boolean {
  const hex = b.subarray(0, 12).toString("hex");
  if (mime === "image/png") return hex.startsWith("89504e470d0a1a0a");
  if (mime === "image/jpeg") return hex.startsWith("ffd8ff");
  if (mime === "image/gif") return hex.startsWith("47494638");
  if (mime === "image/webp") return hex.startsWith("52494646") && b.subarray(8, 12).toString("latin1") === "WEBP";
  return false;
}

/** Text a model reads from one attachment at most. */
export const ATTACHMENT_TEXT_CHARS = 20_000;

export function isReadable(mime: string): boolean {
  return TEXT.test(mime);
}

/** Validates and stores an attachment; throws a message the owner can act on. */
export function saveUpload(
  home: string,
  store: Store,
  a: { name: string; mime: string; bytes: Buffer; thread?: string | undefined },
): MediaRecord & { name: string } {
  const image = IMAGES[a.mime];
  const readable = isReadable(a.mime);
  if (!image && !readable && !OTHER[a.mime]) throw new Error(`${a.name}: ${a.mime || "this type"} cannot be attached`);
  const limit = image ? UPLOAD_LIMITS.imageBytes : UPLOAD_LIMITS.fileBytes;
  if (a.bytes.length > limit) throw new Error(`${a.name} is over ${Math.round(limit / 1024 / 1024)} MB`);
  if (!a.bytes.length) throw new Error(`${a.name} is empty`);
  // A model refuses an image whose bytes are not what its type says: catch it here, with a reason the owner reads.
  if (image && !looksLike(a.mime, a.bytes)) throw new Error(`${a.name} is not a ${image.toUpperCase()} image`);
  // A "text" file with NUL bytes is binary in disguise: it would reach the model as noise.
  if (readable && a.bytes.includes(0)) throw new Error(`${a.name} is not a text file`);
  const dir = path.join(home, "media", "uploads", new Date().toISOString().slice(0, 10));
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `${randomUUID()}.${image ?? OTHER[a.mime] ?? "txt"}`);
  fs.writeFileSync(file, a.bytes, { flag: "wx" });
  const media = store.media.add({
    kind: image ? "image" : "file",
    mime: a.mime,
    bytes: a.bytes.length,
    path: file,
    thread_id: a.thread,
    prompt: a.name,
  });
  return { ...media, name: a.name };
}

/** A stored file's bytes, base64 (images for a model call). */
export function mediaData(store: Store, id: string): { mime: string; data: string } | undefined {
  const m = store.media.get(id);
  if (!m) return undefined;
  try {
    return { mime: m.mime, data: fs.readFileSync(m.path).toString("base64") };
  } catch {
    return undefined;
  }
}
