// Files the owner attaches in the composer, or someone sends on a channel. Images are kept for models that can look at
// them; text files are read into the turn (capped, as outside content); any other type is kept to play or download,
// and can be copied into the turn work folder.
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
const AUDIO: Record<string, string> = {
  "audio/webm": "webm",
  "audio/ogg": "ogg",
  "audio/mp4": "m4a",
  "audio/x-m4a": "m4a",
  "audio/mpeg": "mp3",
  "audio/wav": "wav",
  "audio/x-wav": "wav",
  "audio/flac": "flac",
  "audio/x-flac": "flac",
  "audio/aac": "aac",
};
/** Text the agent can read as is. */
const TEXT = /^(text\/[a-z0-9.+-]+|application\/(json|xml|x-yaml|yaml|csv|x-ndjson|javascript|typescript|x-sh))$/;
/** Known binary types and their extension on disk; any other type is kept as `.bin`. */
const OTHER: Record<string, string> = {
  "application/pdf": "pdf",
  "application/octet-stream": "bin",
  "application/zip": "zip",
  "application/msword": "doc",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "docx",
  "application/vnd.ms-excel": "xls",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": "xlsx",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation": "pptx",
  "video/mp4": "mp4",
  "video/webm": "webm",
  "video/quicktime": "mov",
  "video/3gpp": "3gp",
  "video/x-matroska": "mkv",
};
/** A type as the platform or browser named it, or a plain binary one when it named none (or nonsense). */
const typeOf = (mime: string) => {
  const m = mime.trim().toLowerCase();
  return /^[a-z0-9.+-]+\/[a-z0-9.+-]+$/.test(m) ? m : "application/octet-stream";
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
  maxBytes?: number,
): MediaRecord & { name: string } {
  const mime = typeOf(a.mime.split(";")[0] ?? "");
  const image = IMAGES[mime];
  const audio = AUDIO[mime];
  const readable = isReadable(mime);
  const limit =
    maxBytes ?? (image ? UPLOAD_LIMITS.imageBytes : audio ? UPLOAD_LIMITS.audioBytes : UPLOAD_LIMITS.fileBytes);
  if (a.bytes.length > limit) throw new Error(`${a.name} is over ${Math.round(limit / 1024 / 1024)} MB`);
  if (!a.bytes.length) throw new Error(`${a.name} is empty`);
  // A model refuses an image whose bytes are not what its type says: catch it here, with a reason the owner reads.
  if (image && !looksLike(mime, a.bytes)) throw new Error(`${a.name} is not a ${image.toUpperCase()} image`);
  // A "text" file with NUL bytes is binary in disguise: it would reach the model as noise.
  if (readable && a.bytes.includes(0)) throw new Error(`${a.name} is not a text file`);
  const dir = path.join(home, "media", "uploads", new Date().toISOString().slice(0, 10));
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `${randomUUID()}.${image ?? audio ?? (readable ? "txt" : (OTHER[mime] ?? "bin"))}`);
  fs.writeFileSync(file, a.bytes, { flag: "wx" });
  try {
    const media = store.media.add({
      kind: image ? "image" : audio ? "audio" : "file",
      mime: audio ? a.mime : mime,
      bytes: a.bytes.length,
      path: file,
      thread_id: a.thread,
      prompt: a.name,
    });
    return { ...media, name: a.name };
  } catch (error) {
    fs.rmSync(file, { force: true });
    throw error;
  }
}

/** Abandoned task drafts expire; ordinary chat media and committed task snapshots are not pending uploads. */
export function pruneTaskUploads(store: Store, at = new Date()): void {
  const cutoff = new Date(at.getTime() - 24 * 60 * 60 * 1000).toISOString();
  for (const m of store.taskAttachments.expired(cutoff)) {
    try {
      fs.rmSync(m.path, { force: true });
      store.media.remove(m.id);
    } catch {
      /* A later sweep retries a file the filesystem could not remove. */
    }
  }
}

/** Deletes a thread's files kept under `name` beyond the newest `keep`, rows and bytes. */
export function pruneUploads(store: Store, thread: string, name: string, keep: number): void {
  for (const m of store.media
    .named(thread, name)
    .filter((m) => !store.taskAttachments.hasMedia(m.id))
    .slice(keep)) {
    fs.rmSync(m.path, { force: true });
    store.media.remove(m.id);
  }
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
