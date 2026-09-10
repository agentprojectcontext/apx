// Files people send — kept, read where we can, and refused where we should.
//
// Documents used to be the one kind of message APX threw away. A contact sent a
// quote as a PDF and the thread recorded `[document: … — not opened]`: no
// bytes, no text, nothing to answer with. Everything else that arrives is
// handled — a voice note is transcribed, a photo is looked at, a sticker has a
// meaning — and the file, the one thing somebody deliberately attached, was the
// exception.
//
// So the rule is: KEEP EVERYTHING, READ WHAT WE CAN, REFUSE WHAT IS DANGEROUS.
// The three parts are separate decisions and this file makes them in that
// order.
//
// What "dangerous" means here is narrow and worth being precise about, because
// the obvious reading is wrong. Nothing in APX ever executes an attachment, so
// the risk is not that the daemon runs it. The risk is that the file lands in
// the owner's own media folder, under a name a STRANGER chose, one double-click
// away — and that a name like `cotizacion.pdf.exe` reads as a PDF in every
// surface that shows it. That is what the refusal list is for: the installer
// and script classes never touch the disk, and the marker says so plainly so
// nobody is left wondering whether the message arrived.
//
// Archives (zip, rar, 7z) are NOT refused. They are how people send three files
// at once, they cannot run on their own, and refusing them would break the
// common case to prevent a hazard that only exists once somebody extracts and
// runs what is inside. Kept, never opened.
import fs from "node:fs";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { envWithPath } from "#core/util/path-env.js";

const run = promisify(execFile);

/**
 * Extensions that never reach the disk.
 *
 * Matched on the LAST extension, which is the one the operating system obeys —
 * so `cotizacion.pdf.exe` is refused as the `.exe` it is, not kept as the PDF
 * it is dressed as.
 */
export const REFUSED_EXTENSIONS = new Set([
  // Windows
  "exe", "msi", "com", "scr", "pif", "bat", "cmd", "hta", "cpl", "msc", "reg", "lnk", "dll", "sys",
  // scripts, any platform
  "vbs", "vbe", "wsf", "wsh", "ps1", "psm1", "sh", "bash", "zsh", "command", "js", "jse", "mjs", "py", "rb", "pl",
  // installers and runnables
  "jar", "apk", "app", "dmg", "pkg", "deb", "rpm", "run", "bin", "appimage", "gadget", "efi", "iso", "img",
]);

/** Media types that say "this is a program" whatever the file is called. */
const REFUSED_MIME_RE =
  /^application\/(x-msdownload|x-msdos-program|x-ms-installer|vnd\.microsoft\.portable-executable|x-executable|x-elf|x-sharedlib|x-mach-binary|x-apple-diskimage|vnd\.android\.package-archive|java-archive|x-sh|x-shellscript|x-python-code|x-bat)$/i;

/**
 * Anything past this is not downloaded.
 *
 * WhatsApp allows 2 GB. This is a chat assistant's inbox, not a file server:
 * the daemon holds the whole download in memory before it hits the disk, and a
 * contact sending a video-sized "document" would take the process with it. The
 * marker names the size so the owner can fetch it from their phone.
 */
export const MAX_DOCUMENT_BYTES = 25 * 1024 * 1024;

/** How much of a file's text is folded into the prompt. */
export const MAX_TEXT_CHARS = 12_000;

const TEXT_EXTENSIONS = new Set([
  "txt", "text", "md", "markdown", "csv", "tsv", "json", "xml", "yaml", "yml",
  "log", "ini", "conf", "cfg", "toml", "srt", "vtt", "html", "htm", "rtf",
]);

const lastExt = (name) => {
  const ext = path.extname(String(name || "")).slice(1).toLowerCase();
  return ext || "";
};

/**
 * A file name we are willing to write.
 *
 * The name comes off the wire, from somebody else's phone, and it is used to
 * build a path. Basename first (so `../../.ssh/authorized_keys` becomes
 * `authorized_keys`), then everything that is not a plain name character goes,
 * and the length is capped — a 400-character name is not a name, it is an
 * attempt at something.
 */
export function safeFileName(raw, fallback = "file") {
  const base = path.basename(String(raw || "")).replace(/[^A-Za-z0-9._-]+/g, "_").replace(/^\.+/, "");
  const clean = base.slice(0, 120);
  return clean || fallback;
}

/**
 * What to do with this document, decided BEFORE any bytes are downloaded.
 *
 * @returns {{ keep: boolean, refusal: string|null, read: "text"|"pdf"|null, name: string, ext: string }}
 *   `refusal` is a sentence for the owner, not a code — it is what the thread
 *   will say, and "refused" with no reason is how a message becomes a mystery.
 */
export function documentPolicy({ fileName = "", mimeType = "", size = null } = {}) {
  const name = safeFileName(fileName);
  const ext = lastExt(name);
  const mime = String(mimeType || "").toLowerCase().split(";")[0].trim();

  if (REFUSED_EXTENSIONS.has(ext) || REFUSED_MIME_RE.test(mime)) {
    return { keep: false, refusal: `a .${ext || "bin"} file, which APX does not keep — programs and scripts are never saved`, read: null, name, ext };
  }
  if (Number.isFinite(size) && size > MAX_DOCUMENT_BYTES) {
    return {
      keep: false,
      refusal: `${Math.round(size / (1024 * 1024))} MB, over the ${Math.round(MAX_DOCUMENT_BYTES / (1024 * 1024))} MB limit — it was not downloaded`,
      read: null, name, ext,
    };
  }

  const read =
    ext === "pdf" || mime === "application/pdf" ? "pdf"
    : TEXT_EXTENSIONS.has(ext) || mime.startsWith("text/") || mime === "application/json" || mime === "application/xml" ? "text"
    : null;
  return { keep: true, refusal: null, read, name, ext };
}

/** Cut long text on a line boundary and say that it was cut. */
function clamp(text, max = MAX_TEXT_CHARS) {
  const s = String(text || "").replace(/\r\n/g, "\n").trim();
  if (s.length <= max) return s;
  const cut = s.slice(0, max);
  const at = cut.lastIndexOf("\n");
  return `${(at > max * 0.6 ? cut.slice(0, at) : cut).trimEnd()}\n… (the file is longer; this is the first part)`;
}

/**
 * The words inside a file, or "".
 *
 * PDFs go through `pdftotext` (poppler), reached with envWithPath() because a
 * launchd-booted daemon has no Homebrew on its PATH — the same reason ffmpeg is
 * called that way one file over. It is optional: no poppler means the file is
 * still kept and the thread says it could not be read, which is worse than
 * reading it and much better than the old "not opened".
 *
 * Never throws. A file we cannot parse is a file we describe.
 */
export async function readDocumentText(localPath, read, { maxChars = MAX_TEXT_CHARS } = {}) {
  if (!localPath || !read || !fs.existsSync(localPath)) return "";

  if (read === "text") {
    try {
      // Read the cap, not the file: a 200 MB log truncated after the fact has
      // still been through memory once.
      const fd = fs.openSync(localPath, "r");
      try {
        const buf = Buffer.alloc(Math.min(maxChars * 4, 4 * 1024 * 1024));
        const n = fs.readSync(fd, buf, 0, buf.length, 0);
        return clamp(buf.subarray(0, n).toString("utf8"), maxChars);
      } finally {
        fs.closeSync(fd);
      }
    } catch {
      return "";
    }
  }

  try {
    // `-` writes to stdout; `-layout` keeps columns readable, which is what a
    // quote or an invoice is made of.
    const { stdout } = await run(
      "pdftotext",
      ["-layout", "-nopgbrk", "-q", localPath, "-"],
      { env: envWithPath(), timeout: 30_000, maxBuffer: 8 * 1024 * 1024 }
    );
    return clamp(stdout, maxChars);
  } catch {
    return "";
  }
}

/** `1.4 MB`, `812 KB` — for a marker a person reads. */
export function humanSize(bytes) {
  const n = Number(bytes);
  if (!Number.isFinite(n) || n <= 0) return "";
  if (n >= 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)} MB`;
  if (n >= 1024) return `${Math.round(n / 1024)} KB`;
  return `${n} B`;
}
