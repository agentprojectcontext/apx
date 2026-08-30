// Bytes an agent SENDS, archived where a viewer can actually reach them.
//
// The media endpoint (host/daemon/api/media.js) serves nothing outside
// ~/.apx/media: the path on a stored turn comes back from a record, so it is
// treated as untrusted input and the sandbox is the whole guarantee. But
// everything an agent sends outward STARTS outside that directory — a skill's
// image lives beside its SKILL.md, a generated chart in the project, a
// screenshot arrives as a Buffer and has no path at all. A row that named the
// original file was a path the endpoint had to refuse, so the thread showed
// "attachment failed" for a photo the user had already received on Telegram.
//
// Archiving closes that gap the same way the inbound side already does: copy
// the bytes in once, and let the turn record the copy. Inbound writes to
// ~/.apx/media, the composer to ~/.apx/media/web, and this to ~/.apx/media/out.
//
// Content-addressed on purpose. A skill's diagram attached on a hundred routine
// runs is one file on disk and one stable path across a hundred rows — copying
// per send would grow the media dir without bound for images that never change.
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { APX_HOME } from "#core/config/index.js";

/** The media root, spelled exactly as the endpoint's sandbox spells it. */
function mediaRoot() {
  return path.resolve(APX_HOME, "media");
}

/** ~/.apx/media/out — the outbound half of the archive. */
export function outboundMediaDir() {
  const dir = path.join(mediaRoot(), "out");
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

// Enough of a reverse MIME table to name a Buffer that arrived with no
// filename. An unknown type keeps `.bin`: the endpoint serves it as an
// octet-stream attachment, which is the honest answer for bytes we cannot
// classify.
const EXT_BY_MIME = {
  "image/jpeg": ".jpg",
  "image/png": ".png",
  "image/gif": ".gif",
  "image/webp": ".webp",
  "image/heic": ".heic",
  "audio/ogg": ".ogg",
  "audio/mpeg": ".mp3",
  "audio/wav": ".wav",
  "audio/mp4": ".m4a",
  "audio/webm": ".weba",
  "video/mp4": ".mp4",
  "video/quicktime": ".mov",
  "video/webm": ".webm",
  "application/pdf": ".pdf",
  "text/plain": ".txt",
  "text/markdown": ".md",
  "text/csv": ".csv",
  "application/json": ".json",
};

const MIME_BY_EXT = {
  ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png",
  ".gif": "image/gif", ".webp": "image/webp", ".heic": "image/heic",
  ".svg": "image/svg+xml",
  ".oga": "audio/ogg", ".ogg": "audio/ogg", ".opus": "audio/ogg",
  ".weba": "audio/webm", ".mp3": "audio/mpeg", ".wav": "audio/wav",
  ".m4a": "audio/mp4", ".aac": "audio/aac",
  ".mp4": "video/mp4", ".mov": "video/quicktime", ".webm": "video/webm",
  ".pdf": "application/pdf", ".txt": "text/plain", ".md": "text/markdown",
  ".csv": "text/csv", ".json": "application/json", ".log": "text/plain",
};

function isUrl(v) {
  return typeof v === "string" && /^https?:\/\//i.test(v);
}

/** Is this path already inside the archive? Then there is nothing to copy. */
function insideMediaRoot(abs) {
  const root = mediaRoot();
  let real;
  try {
    real = fs.realpathSync(abs);
  } catch {
    return false;
  }
  let realRoot;
  try {
    realRoot = fs.realpathSync(root);
  } catch {
    realRoot = root;
  }
  return real === realRoot || real.startsWith(realRoot + path.sep);
}

/** The leaf name a viewer shows. Basename only, sanitised, bounded. */
function displayName(raw, fallbackExt) {
  const base = path.basename(String(raw || "")).replace(/[^\w.\- ]+/g, "_").trim();
  if (!base) return `file${fallbackExt}`;
  const ext = path.extname(base);
  const stem = base.slice(0, base.length - ext.length).slice(0, 60).trim() || "file";
  return `${stem}${ext || fallbackExt}`;
}

/**
 * Put one outbound file in the archive and describe it the way a stored turn
 * describes a file.
 *
 * @param {string|Buffer} source  absolute path, Buffer, or http(s) URL
 * @param {object} [opts]
 * @param {string} [opts.filename]  the name to SHOW (a Buffer has none of its own)
 * @param {string} [opts.mime]      declared type; the extension decides otherwise
 * @returns {{local_path:string, file_name:string, mime_type:string, file_size:number}|null}
 *   null when there is nothing to archive: a URL (Telegram fetched it, we never
 *   held the bytes) or an unreadable path. The caller still records the message;
 *   it just records it without a file, which is the truth in that case.
 */
export function archiveOutboundMedia(source, { filename, mime } = {}) {
  if (!source) return null;
  if (isUrl(source)) return null;

  let buf = null;
  let sourcePath = null;
  if (Buffer.isBuffer(source)) {
    buf = source;
  } else if (typeof source === "string") {
    sourcePath = path.resolve(source);
    try {
      buf = fs.readFileSync(sourcePath);
    } catch {
      return null; // gone, unreadable, or never a path — nothing to point at
    }
  } else {
    return null;
  }
  if (!buf.length) return null;

  const nameHint = filename || (sourcePath ? path.basename(sourcePath) : "");
  const ext =
    (path.extname(nameHint) || "").toLowerCase() ||
    EXT_BY_MIME[String(mime || "").toLowerCase()] ||
    ".bin";
  const mime_type = mime || MIME_BY_EXT[ext] || "application/octet-stream";
  const file_name = displayName(nameHint, ext);

  // Already ours: a file the composer uploaded, or one archived by an earlier
  // send. Point at it where it lies rather than making a second copy.
  if (sourcePath && insideMediaRoot(sourcePath)) {
    return { local_path: fs.realpathSync(sourcePath), file_name, mime_type, file_size: buf.length };
  }

  const digest = crypto.createHash("sha256").update(buf).digest("hex").slice(0, 16);
  const stored = path.join(outboundMediaDir(), `${digest}${ext}`);
  let real;
  try {
    // Same bytes, same name: an image attached on every run is written once.
    if (!fs.existsSync(stored)) fs.writeFileSync(stored, buf);
    // The REAL path is the canonical one, the same rule /media/upload follows:
    // on a home behind a symlink (a macOS temp dir, a relocated ~) /var and
    // /private/var are one file and two strings. Two spellings of one
    // attachment break every comparison downstream — the client dedupes an
    // optimistic bubble against the stored one by attachment path.
    real = fs.realpathSync(stored);
  } catch {
    return null;
  }
  return { local_path: real, file_name, mime_type, file_size: buf.length };
}

/**
 * The flat meta a stored row carries for ONE file — the exact field names
 * `mediaFromMeta` (core/stores/messages.js) reads back. One place builds this
 * shape so the ledger, a conversation file and a routine delivery cannot drift
 * into three spellings of the same attachment.
 *
 * @param {string} kind  photo | audio | video | animation | document | file
 * @param {object|null} archived  an archiveOutboundMedia() result
 * @param {object} [extra]  e.g. { duration } for a voice note
 * @returns {object} the meta fields, or {} when there is no file to record
 */
export function outboundMediaMeta(kind, archived, extra = {}) {
  if (!archived?.local_path) return {};
  return {
    media_kind: kind,
    local_path: archived.local_path,
    file_name: archived.file_name || null,
    mime_type: archived.mime_type || null,
    file_size: archived.file_size ?? null,
    ...(Number.isFinite(Number(extra.duration)) ? { duration: Number(extra.duration) } : {}),
  };
}

/**
 * Archive a queued attachment list (attach_media's sink, a routine's delivery)
 * and shape the meta a row carries for it.
 *
 * The row keeps BOTH spellings for the same reason the routine delivery always
 * did: `media` is the full list a viewer renders, and the flat fields mirror
 * the FIRST file so a reader that only understands one attachment still sees
 * one. Items that cannot be archived are dropped — a path pointing nowhere is
 * not an attachment, and half a card is worse than none.
 *
 * @param {Array<{path?:string, file?:string, mime?:string, caption?:string}>} items
 * @param {string} [kind]  what these are; images by default
 * @returns {object} meta fields ({} when nothing survived)
 */
export function attachmentsMeta(items, kind = "photo") {
  const archived = [];
  for (const item of Array.isArray(items) ? items : []) {
    if (!item) continue;
    const stored = archiveOutboundMedia(item.path, {
      filename: item.file || item.name,
      mime: item.mime,
    });
    if (!stored) continue;
    archived.push({ ...stored, caption: item.caption || "" });
  }
  if (!archived.length) return {};
  return {
    media: archived.map((a) => ({
      kind,
      path: a.local_path,
      name: a.file_name,
      mime: a.mime_type,
      caption: a.caption,
    })),
    ...outboundMediaMeta(kind, archived[0]),
  };
}
