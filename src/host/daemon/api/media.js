// Attachment bytes, both directions.
//
//   GET  /media?path=<abs>       stream a stored attachment
//   POST /media/upload?name=…    store one the web composer is about to send
//
// A photo, voice note or document that arrives over a channel is downloaded to
// ~/.apx/media and its path recorded on the stored turn (dispatch folds it into
// the one inbound record). This streams those bytes back so a viewer can show
// the actual file instead of the text marker the agent was handed — a thread
// that read "[document received: … saved to /Users/…]" told the user nothing.
//
// Sandboxed to that directory, like /voice/tts: the path arrives from a stored
// record, so it is treated as untrusted input. The content type is derived from
// the extension only — never from the request — so a stray file cannot be
// served back as HTML.
//
// The web composer writes into the same directory (subdir `web/`) so a file
// picked, pasted or dropped in the browser reaches the agent by exactly the
// route a Telegram photo does: bytes on disk, path on the turn.
import crypto from "node:crypto";
import express from "express";
import fs from "node:fs";
import path from "node:path";
import { APX_HOME } from "#core/config/index.js";

const MIME = {
  ".oga": "audio/ogg", ".ogg": "audio/ogg", ".opus": "audio/ogg",
  ".mp3": "audio/mpeg", ".wav": "audio/wav", ".m4a": "audio/mp4", ".aac": "audio/aac",
  ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png", ".gif": "image/gif",
  ".webp": "image/webp", ".heic": "image/heic",
  ".mp4": "video/mp4", ".mov": "video/quicktime", ".webm": "video/webm",
  ".pdf": "application/pdf",
  ".txt": "text/plain", ".md": "text/markdown", ".csv": "text/csv",
  ".json": "application/json", ".log": "text/plain",
};

// What the composer may hand over. The gate is the extension — the request's
// own content type is never trusted here either — so the set stays small and
// purposeful: images a multimodal engine can see, audio it can transcribe,
// documents its file tools can open. Nothing executable, and nothing a browser
// would run if it ever escaped the Content-Disposition below.
const UPLOAD_EXT = new Set([
  ".jpg", ".jpeg", ".png", ".gif", ".webp", ".heic",
  ".oga", ".ogg", ".opus", ".mp3", ".wav", ".m4a", ".aac",
  ".mp4", ".mov", ".webm",
  ".pdf", ".txt", ".md", ".csv", ".json", ".log",
]);

// 25 MB. Above this the base64 an image turn carries starts to dominate the
// model's context window, and the point of the cap is the turn, not the disk.
const MAX_UPLOAD = 25 * 1024 * 1024;

// An extension the allowlist trusts must be backed by the bytes it claims:
// otherwise ".png" is just a four-character promise, and the file that lands in
// the media dir is whatever the caller wanted to put there. Only the formats
// with a stable signature are checked; the rest pass on the extension alone.
const MAGIC = [
  { ext: [".jpg", ".jpeg"], at: 0, bytes: [0xff, 0xd8, 0xff] },
  { ext: [".png"], at: 0, bytes: [0x89, 0x50, 0x4e, 0x47] },
  { ext: [".gif"], at: 0, bytes: [0x47, 0x49, 0x46, 0x38] },
  { ext: [".webp"], at: 8, bytes: [0x57, 0x45, 0x42, 0x50] },
  { ext: [".pdf"], at: 0, bytes: [0x25, 0x50, 0x44, 0x46] },
];

function magicMatches(ext, buf) {
  const rule = MAGIC.find((m) => m.ext.includes(ext));
  if (!rule) return true;
  if (buf.length < rule.at + rule.bytes.length) return false;
  return rule.bytes.every((b, i) => buf[rule.at + i] === b);
}

/** The media dir itself. One root for the read and the write side. */
function mediaRoot() {
  return path.resolve(APX_HOME, "media");
}

/** `photo` | `audio` | `video` | `document`, from the resolved mime. */
function kindFromMime(mime) {
  if (mime.startsWith("image/")) return "photo";
  if (mime.startsWith("audio/")) return "audio";
  if (mime.startsWith("video/")) return "video";
  return "document";
}

function mimeFor(file) {
  return MIME[path.extname(file).toLowerCase()] || "application/octet-stream";
}

/**
 * A filename fit to store and to show. The caller's name is a display string
 * from an untrusted client: only its basename survives, separators and control
 * characters included, and the stem is capped so a 300-character name cannot
 * push the stored path past the filesystem's limit.
 */
function safeName(raw) {
  const base = path.basename(String(raw || "")).replace(/[^\w.\- ]+/g, "_").trim();
  const ext = path.extname(base).toLowerCase();
  const stem = base.slice(0, base.length - ext.length).slice(0, 60).trim() || "file";
  return { name: `${stem}${ext}`, ext, stem };
}

// Shown in the browser rather than pushed to Downloads. Everything else gets
// `attachment`, so an unknown type can never render in the app's own origin.
const INLINE = /^(audio|image|video)\//;

function tryRealpath(p) {
  try {
    return fs.realpathSync(p);
  } catch {
    return null;
  }
}

/** The real path of a file inside ~/.apx/media, or null if it escapes. */
function resolveInMediaDir(raw) {
  const root = mediaRoot();
  const asked = path.resolve(raw);
  // Lexical guard first, so a path from outside the media dir never reaches the
  // filesystem at all. Both spellings of the root count: what a stored turn
  // carries is the resolved path, and on a home behind a symlink (a macOS temp
  // dir, a relocated ~) the unresolved root would refuse our own file.
  const roots = [root, tryRealpath(root)].filter(Boolean);
  if (!roots.some((r) => asked === r || asked.startsWith(r + path.sep))) return null;
  if (!fs.existsSync(asked)) return null;
  // Symlinks are resolved on both sides: a link inside the media dir must not
  // become a window onto the rest of the disk.
  const real = fs.realpathSync(asked);
  const realRoot = fs.realpathSync(root);
  if (!real.startsWith(realRoot + path.sep)) return null;
  return real;
}

/**
 * The files a turn is being sent with, resolved from the media dir.
 *
 * Returns what each consumer needs: `attachments` for the model (images only —
 * a multimodal engine renders them, the others ignore the field), `markers` for
 * the prompt (so an engine without vision still knows a file arrived and where
 * it is), and `media` shaped as the ledger meta a stored turn carries, so a
 * reopened thread shows the file instead of the marker. Mirrors what the
 * Telegram inbound handlers hand to dispatch.
 *
 * Anything that does not resolve inside the media dir is dropped in silence:
 * the paths come back from a client, and a turn is not the place to explain a
 * path that a caller had no business sending.
 */
export function readTurnAttachments(raw) {
  const attachments = [];
  const markers = [];
  let media = null;
  for (const item of Array.isArray(raw) ? raw : []) {
    let resolved = null;
    try {
      resolved = resolveInMediaDir(String(item?.path || ""));
    } catch {
      resolved = null;
    }
    if (!resolved) continue;
    const mime = mimeFor(resolved);
    const name = item?.name ? safeName(item.name).name : path.basename(resolved);
    let size = null;
    try {
      size = fs.statSync(resolved).size;
    } catch {
      /* the stat is metadata; a readable file without it still goes through */
    }
    if (mime.startsWith("image/")) {
      try {
        attachments.push({
          kind: "image",
          mime,
          data: fs.readFileSync(resolved).toString("base64"),
          path: resolved,
        });
      } catch {
        /* unreadable: the marker below still names the path */
      }
      markers.push(`[image attached — saved to ${resolved}]`);
    } else {
      markers.push(
        `[file attached: ${name}, ${mime} — saved to ${resolved}. You can open it with your file tools.]`,
      );
    }
    // One attachment per stored turn, as on every other channel: the ledger row
    // holds a single file, so a turn sent with several records the first.
    media ??= {
      media_kind: kindFromMime(mime),
      local_path: resolved,
      file_name: name,
      mime_type: mime,
      file_size: size,
    };
  }
  return { attachments, markers, media };
}

// Body parser for the upload: raw bytes, not multipart (one file per request,
// so a boundary parser would earn nothing) and not base64 in JSON (which would
// inflate every image by a third and fight the 2 MB global JSON limit). Its own
// errors are answered here as JSON — the default is an HTML error page, which a
// fetch() caller can only report as gibberish.
const rawBody = express.raw({ type: "*/*", limit: MAX_UPLOAD });
function readRawBody(req, res, next) {
  rawBody(req, res, (err) => {
    if (!err) return next();
    if (err.type === "entity.too.large") {
      return res.status(413).json({ error: `file too large (max ${MAX_UPLOAD / (1024 * 1024)} MB)` });
    }
    res.status(400).json({ error: err.message || "upload failed" });
  });
}

export function register(api) {
  // Store one attachment the composer is about to send. The name rides in the
  // query because the body is the file itself; the extension it carries is the
  // only thing that decides what this is willing to keep.
  api.post("/media/upload", readRawBody, (req, res) => {
    const buf = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
    if (!buf.length) return res.status(400).json({ error: "empty upload" });

    const { name, ext, stem } = safeName(req.query.name);
    if (!ext || !UPLOAD_EXT.has(ext)) {
      return res.status(415).json({ error: `file type not allowed: ${ext || "no extension"}` });
    }
    if (!magicMatches(ext, buf)) {
      return res.status(415).json({ error: `the file's bytes do not match ${ext}` });
    }

    try {
      const dir = path.join(mediaRoot(), "web");
      fs.mkdirSync(dir, { recursive: true });
      // The stored name is ours, never the caller's: a random stem keeps two
      // uploads of "image.png" apart and keeps a guessed path from reaching a
      // file that is not the guesser's.
      const stored = path.join(dir, `${crypto.randomUUID().slice(0, 8)}-${stem}${ext}`);
      fs.writeFileSync(stored, buf);
      // The real path is the canonical one: it is what the turn side resolves
      // to (symlinks and all), so client and daemon name the same file the same
      // way — on a macOS temp dir, /var and /private/var are the same file and
      // two different strings.
      const real = fs.realpathSync(stored);
      const mime = mimeFor(real);
      res.status(201).json({
        path: real,
        name,
        mime,
        kind: kindFromMime(mime),
        size: buf.length,
      });
    } catch (e) {
      res.status(500).json({ error: e?.message || "upload failed" });
    }
  });

  api.get("/media", (req, res) => {
    const raw = String(req.query.path || "");
    if (!raw) return res.status(400).json({ error: "path required" });
    let resolved;
    try {
      resolved = resolveInMediaDir(raw);
    } catch (e) {
      return res.status(500).json({ error: e?.message || "media read failed" });
    }
    if (!resolved) return res.status(404).json({ error: "not found" });

    const mime = MIME[path.extname(resolved).toLowerCase()] || "application/octet-stream";
    const name = path.basename(resolved).replace(/["\\]/g, "");
    res.setHeader("Content-Type", mime);
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader(
      "Content-Disposition",
      `${INLINE.test(mime) ? "inline" : "attachment"}; filename="${name}"`,
    );
    res.setHeader("Cache-Control", "private, max-age=300");
    const stream = fs.createReadStream(resolved);
    stream.on("error", () => res.destroy());
    stream.pipe(res);
  });
}
