// What an agent may hand the owner as a FILE — the policy send_file checks
// before a path ever reaches the delivery adapters (web chat, Telegram).
//
// Two layers, on purpose:
//   - `config.file_delivery.kinds` is the owner's choice, per kind of file
//     (image / video / audio / document). Images are on by default, the rest
//     off: the first stage of this feature is "it can send me a picture", and
//     widening it is a decision the owner makes, not a default we pick.
//   - BLOCKED_EXTENSIONS and SENSITIVE_DIRS are NOT configurable. An
//     executable or a private key is not a kind of file you opt into; it is
//     never an attachment, whatever the config says.
//
// The kind comes from the extension, and an image's bytes are checked against
// it — a `.png` that is really something else is refused, so renaming a file
// is not a way around the kinds switch.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { APX_HOME } from "#core/config/index.js";

export const FILE_KINDS = Object.freeze(["image", "video", "audio", "document"]);

export const DEFAULT_FILE_DELIVERY = Object.freeze({
  kinds: Object.freeze({ image: true, video: false, audio: false, document: false }),
  max_mb: 20,
});

const KIND_BY_EXT = {
  ".png": "image", ".jpg": "image", ".jpeg": "image", ".gif": "image", ".webp": "image",
  ".mp4": "video", ".mov": "video", ".webm": "video",
  ".mp3": "audio", ".wav": "audio", ".ogg": "audio", ".oga": "audio", ".m4a": "audio",
  ".pdf": "document", ".txt": "document", ".md": "document", ".csv": "document",
  ".json": "document", ".docx": "document", ".xlsx": "document", ".pptx": "document",
  ".zip": "document",
};

const MIME_BY_EXT = {
  ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".gif": "image/gif",
  ".webp": "image/webp", ".mp4": "video/mp4", ".mov": "video/quicktime", ".webm": "video/webm",
  ".mp3": "audio/mpeg", ".wav": "audio/wav", ".ogg": "audio/ogg", ".oga": "audio/ogg",
  ".m4a": "audio/mp4", ".pdf": "application/pdf", ".txt": "text/plain", ".md": "text/markdown",
  ".csv": "text/csv", ".json": "application/json",
  ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ".pptx": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  ".zip": "application/zip",
};

// The kind the chat renderer and the message store use for each file kind.
const MEDIA_KIND = { image: "photo", video: "video", audio: "audio", document: "document" };

/** Never delivered, whatever `kinds` says: things that run when opened. */
export const BLOCKED_EXTENSIONS = new Set([
  ".exe", ".msi", ".bat", ".cmd", ".com", ".scr", ".pif", ".cpl", ".dll", ".sys",
  ".ps1", ".psm1", ".vbs", ".vbe", ".js", ".jse", ".wsf", ".wsh", ".hta", ".msc",
  ".jar", ".apk", ".app", ".dmg", ".pkg", ".deb", ".rpm", ".sh", ".bash", ".zsh",
  ".command", ".run", ".bin", ".lnk", ".reg", ".iso", ".appimage",
]);

/** Directories whose contents are secrets, not attachments. */
function sensitiveDirs() {
  const home = os.homedir();
  return [
    path.join(home, ".ssh"),
    path.join(home, ".gnupg"),
    path.join(home, ".aws"),
    path.join(home, ".config", "gcloud"),
    path.join(home, ".kube"),
    // Config, tokens and conversations live here. Its media/ folder is the one
    // exception: that is where outbound files are archived and uploads land.
    path.resolve(APX_HOME),
  ];
}

/** The real spelling of a directory, so it compares against a realpath'd file
 *  (on macOS /var and /private/var are one folder and two strings). */
function real(dir) {
  try {
    return fs.realpathSync(dir);
  } catch {
    return path.resolve(dir);
  }
}

function inside(child, parent) {
  const rel = path.relative(parent, child);
  return rel === "" || (!!rel && !rel.startsWith("..") && !path.isAbsolute(rel));
}

function isSensitive(file) {
  if (inside(file, real(path.join(APX_HOME, "media")))) return false;
  return sensitiveDirs().some((dir) => inside(file, real(dir)));
}

/** The effective policy: defaults, overlaid by `config.file_delivery`. */
export function deliveryPolicy(cfg = {}) {
  const raw = cfg?.file_delivery || {};
  const kinds = { ...DEFAULT_FILE_DELIVERY.kinds };
  for (const k of FILE_KINDS) {
    if (typeof raw.kinds?.[k] === "boolean") kinds[k] = raw.kinds[k];
  }
  const max = Number(raw.max_mb);
  return {
    kinds,
    max_mb: Number.isFinite(max) && max > 0 ? Math.min(max, 100) : DEFAULT_FILE_DELIVERY.max_mb,
  };
}

/** The kinds the policy lets through, for an error the model can act on. */
export function allowedKinds(policy) {
  return FILE_KINDS.filter((k) => policy.kinds[k]);
}

function imageBytesMatch(ext, buf) {
  const b = buf.subarray(0, 12);
  const has = (...bytes) => bytes.every((v, i) => b[i] === v);
  switch (ext) {
    case ".png": return has(0x89, 0x50, 0x4e, 0x47);
    case ".jpg":
    case ".jpeg": return has(0xff, 0xd8, 0xff);
    case ".gif": return b.subarray(0, 4).toString("latin1") === "GIF8";
    case ".webp": return b.subarray(0, 4).toString("latin1") === "RIFF" && b.subarray(8, 12).toString("latin1") === "WEBP";
    default: return true;
  }
}

/**
 * May this file go to the owner?
 *
 * @param {string} filePath  absolute path
 * @param {ReturnType<typeof deliveryPolicy>} policy
 * @returns {{ok:true, path:string, kind:string, media_kind:string, mime:string, size:number}
 *          | {ok:false, reason:string}}
 */
export function checkDeliverable(filePath, policy) {
  if (!filePath || !path.isAbsolute(filePath)) {
    return { ok: false, reason: "path must be absolute" };
  }
  let resolved;
  let stat;
  try {
    resolved = fs.realpathSync(filePath);
    stat = fs.statSync(resolved);
  } catch {
    return { ok: false, reason: `file not found: ${filePath}` };
  }
  if (!stat.isFile()) return { ok: false, reason: "not a regular file" };

  const ext = path.extname(resolved).toLowerCase();
  if (BLOCKED_EXTENSIONS.has(ext) || BLOCKED_EXTENSIONS.has(path.extname(filePath).toLowerCase())) {
    return { ok: false, reason: `${ext || "this"} files are never sent: they run when opened` };
  }
  if (isSensitive(resolved)) {
    return { ok: false, reason: "that folder holds credentials and private state; its files are never sent" };
  }
  const kind = KIND_BY_EXT[ext];
  if (!kind) {
    return { ok: false, reason: `unsupported file type: ${ext || "no extension"}` };
  }
  if (!policy.kinds[kind]) {
    const allowed = allowedKinds(policy);
    return {
      ok: false,
      reason: `sending ${kind} files is turned off (allowed: ${allowed.join(", ") || "none"}). ` +
        "The owner can enable it under file_delivery.kinds.",
    };
  }
  if (stat.size === 0) return { ok: false, reason: "the file is empty" };
  if (stat.size > policy.max_mb * 1024 * 1024) {
    return { ok: false, reason: `file is ${(stat.size / 1048576).toFixed(1)} MB; the limit is ${policy.max_mb} MB` };
  }
  if (kind === "image") {
    let head;
    try {
      const fd = fs.openSync(resolved, "r");
      head = Buffer.alloc(12);
      fs.readSync(fd, head, 0, 12, 0);
      fs.closeSync(fd);
    } catch {
      return { ok: false, reason: "could not read the file" };
    }
    if (!imageBytesMatch(ext, head)) {
      return { ok: false, reason: `the file's bytes are not a ${ext} image` };
    }
  }
  return { ok: true, path: resolved, kind, media_kind: MEDIA_KIND[kind], mime: MIME_BY_EXT[ext], size: stat.size };
}
