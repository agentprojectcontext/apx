import fs from "node:fs";
import path from "node:path";
import { DOCUMENT_MAX_BYTES } from "@apx/protocol/client";
import type { Store } from "../domain/store.ts";
import { insideReal, real } from "../paths.ts";
import { saveUpload } from "./uploads.ts";

const MAX_BYTES = 20 * 1024 * 1024;
const MIME: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  webp: "image/webp",
  gif: "image/gif",
  mp4: "video/mp4",
  webm: "video/webm",
  mov: "video/quicktime",
  mp3: "audio/mpeg",
  wav: "audio/wav",
  ogg: "audio/ogg",
  m4a: "audio/mp4",
  flac: "audio/flac",
  aac: "audio/aac",
  pdf: "application/pdf",
  txt: "text/plain",
  md: "text/markdown",
  markdown: "text/markdown",
  csv: "text/csv",
  json: "application/json",
  zip: "application/zip",
  doc: "application/msword",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xls: "application/vnd.ms-excel",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
};

/** A file's type by its extension. */
export const mimeOf = (name: string): string =>
  MIME[path.extname(name).slice(1).toLowerCase()] ?? "application/octet-stream";

/** Reads stored media without following links, blocking on special files or growing beyond the size limit. */
export function readStoredAttachment(file: string): Buffer {
  const fd = fs.openSync(file, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK);
  try {
    const stat = fs.fstatSync(fd);
    if (!stat.isFile() || stat.size > MAX_BYTES || !stat.size) throw new Error("file unavailable or over 20 MB");
    const bytes = Buffer.alloc(stat.size);
    let offset = 0;
    while (offset < bytes.length) {
      const count = fs.readSync(fd, bytes, offset, bytes.length - offset, offset);
      if (!count) throw new Error("file changed while attaching");
      offset += count;
    }
    if (fs.fstatSync(fd).size !== stat.size) throw new Error("file changed while attaching");
    return bytes;
  } finally {
    fs.closeSync(fd);
  }
}

/** Takes a bounded snapshot; subsequent edits or deletion cannot break the chat attachment. */
export function saveLocalAttachment(
  home: string,
  store: Store,
  base: string,
  thread: string,
  file: string,
  document = false,
) {
  const at = real(path.resolve(base, file));
  const relative = path.relative(real(base), at);
  const hidden = (p: string) => p.split(/[\\/]/).some((s) => s.toLowerCase() === ".git");
  if (!insideReal(base, file) || hidden(file) || hidden(relative))
    throw new Error("file is outside the work folder or inside .git");
  if (document && !/\.(md|markdown|txt)$/i.test(file))
    throw new Error("documents must be .md, .markdown or .txt files");
  const fd = fs.openSync(at, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK);
  try {
    const stat = fs.fstatSync(fd);
    if (!stat.isFile()) throw new Error("path is not a regular file");
    if (stat.size > (document ? DOCUMENT_MAX_BYTES : MAX_BYTES))
      throw new Error(document ? `document is over ${DOCUMENT_MAX_BYTES} bytes` : "file is over 20 MB");
    const bytes = Buffer.alloc(stat.size);
    let offset = 0;
    while (offset < bytes.length) {
      const read = fs.readSync(fd, bytes, offset, bytes.length - offset, offset);
      if (!read) throw new Error("file changed while attaching; try again");
      offset += read;
    }
    if (document) {
      if (bytes.includes(0)) throw new Error("document is not a text file");
      try {
        new TextDecoder("utf-8", { fatal: true }).decode(bytes);
      } catch {
        throw new Error("document must contain valid UTF-8 text");
      }
    }
    const name = path.basename(file);
    const mime = mimeOf(name);
    return saveUpload(home, store, { name, mime, bytes, thread }, MAX_BYTES);
  } finally {
    fs.closeSync(fd);
  }
}
