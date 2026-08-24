// apx transcribe — speech-to-text from the command line.
//
//   apx transcribe <file>                 print the transcript, nothing else
//   apx transcribe <a> <b> <c>            bulk: one block per file
//   apx transcribe <dir>                  every audio/video file in a folder
//   apx transcribe <file> --lang es       pin the language (else auto-detect)
//   apx transcribe <file> --provider local|openai|custom   override STT routing
//   apx transcribe <file> --json          machine-readable (object, or array in bulk)
//   cat clip.wav | apx transcribe -       read audio from stdin
//
// A thin client over the daemon's POST /api/transcribe/chunk — the same
// endpoint the desktop overlay and Telegram voice notes use. The heavy lifting
// (the persistent whisper-server.py, provider selection, warm model) already
// runs inside the daemon. Video containers (mp4/mov/…) work too: the daemon
// shells out to ffmpeg, which pulls the audio track out of the container.
// Because the model is preloaded at daemon boot, repeated calls are warm.

import fs from "node:fs";
import path from "node:path";
import { http } from "../http.js";

const c = {
  reset: "\x1b[0m", bold: "\x1b[1m", dim: "\x1b[2m",
  green: "\x1b[32m", red: "\x1b[31m", yellow: "\x1b[33m", gray: "\x1b[90m",
};
const err = (s) => `${c.red}${s}${c.reset}`;
const dim = (s) => `${c.dim}${s}${c.reset}`;
const head = (s) => `${c.bold}${c.green}${s}${c.reset}`;

// Extensions the daemon (via ffmpeg) can decode. Audio containers plus common
// video containers — ffmpeg probes the real content, so a video's audio track
// is extracted transparently.
const AUDIO_EXTS = new Set(["webm", "ogg", "oga", "opus", "m4a", "aac", "mp3", "wav", "flac", "amr", "wma"]);
const VIDEO_EXTS = new Set(["mp4", "mov", "mkv", "m4v", "avi", "3gp", "flv", "wmv", "mpg", "mpeg"]);

// The daemon accepts a format hint and hands bytes to ffmpeg, which probes the
// real container regardless of the hint. We still send the true extension so
// the temp file it writes carries a sane suffix.
function formatFromExt(ext) {
  const e = (ext || "").replace(/^\./, "").toLowerCase();
  if (e === "oga") return "ogg";
  return e || "webm";
}

function isMediaFile(p) {
  const e = path.extname(p).replace(/^\./, "").toLowerCase();
  return AUDIO_EXTS.has(e) || VIDEO_EXTS.has(e);
}

// Expand a positional into concrete files: a directory becomes its media
// children (non-recursive, sorted); a file stays itself.
function expandTarget(target) {
  const resolved = path.resolve(target);
  let stat;
  try { stat = fs.statSync(resolved); } catch { return { missing: resolved }; }
  if (stat.isDirectory()) {
    const kids = fs.readdirSync(resolved)
      .filter((n) => isMediaFile(n))
      .sort()
      .map((n) => path.join(resolved, n));
    return { files: kids, dir: resolved };
  }
  return { files: [resolved] };
}

function readStdin() {
  return new Promise((resolve, reject) => {
    const chunks = [];
    process.stdin.on("data", (c) => chunks.push(c));
    process.stdin.on("end", () => resolve(Buffer.concat(chunks)));
    process.stdin.on("error", reject);
  });
}

async function transcribeOne(buf, format, { lang, provider }) {
  const headers = {
    "content-type": "application/octet-stream",
    "x-audio-format": format,
    "x-language": lang,
    ...(provider ? { "x-provider": provider } : {}),
  };
  const result = await http.postRaw("/api/transcribe/chunk", buf, { headers });
  if (result && result.ok === false) {
    throw new Error(result.error || "transcription failed");
  }
  return result;
}

export async function cmdTranscribe(args) {
  const targets = args._.filter(Boolean);
  const lang = args.flags.lang || args.flags.language || "auto";
  const provider = args.flags.provider || null;
  const asJson = !!args.flags.json;

  if (!targets.length) {
    process.stderr.write(
      err("apx transcribe: missing audio/video file") + "\n" +
      dim("Usage: apx transcribe <file...|dir> [--lang es] [--provider local|openai|custom] [--json]") + "\n" +
      dim("       cat clip.wav | apx transcribe -") + "\n"
    );
    process.exitCode = 1;
    return;
  }

  // ── stdin ────────────────────────────────────────────────────────────────
  if (targets.length === 1 && targets[0] === "-") {
    const buf = await readStdin();
    if (!buf || !buf.length) {
      process.stderr.write(err("apx transcribe: empty stdin") + "\n");
      process.exitCode = 1;
      return;
    }
    try {
      const result = await transcribeOne(buf, formatFromExt(args.flags.format), { lang, provider });
      process.stdout.write(asJson ? JSON.stringify(result, null, 2) + "\n" : (result?.text || "").trim() + "\n");
    } catch (e) {
      process.stderr.write(err(`apx transcribe: ${e.message}`) + "\n");
      process.exitCode = 1;
    }
    return;
  }

  // ── resolve the full file list (expanding directories) ─────────────────────
  const files = [];
  for (const t of targets) {
    const exp = expandTarget(t);
    if (exp.missing) {
      process.stderr.write(err(`apx transcribe: not found — ${exp.missing}`) + "\n");
      process.exitCode = 1;
      continue;
    }
    if (exp.dir && !exp.files.length) {
      process.stderr.write(dim(`apx transcribe: no audio/video files in ${exp.dir}`) + "\n");
    }
    files.push(...exp.files);
  }
  if (!files.length) {
    if (!process.exitCode) process.exitCode = 1;
    return;
  }

  const single = files.length === 1;
  const jsonResults = [];
  let failures = 0;

  // Sequential on purpose: the local whisper server holds a single model and
  // would queue concurrent requests anyway — serial keeps output ordered and
  // memory flat when a folder holds dozens of clips.
  for (const filePath of files) {
    let result;
    try {
      const buf = fs.readFileSync(filePath);
      if (!buf.length) throw new Error("empty file");
      result = await transcribeOne(buf, formatFromExt(path.extname(filePath)), { lang, provider });
    } catch (e) {
      failures++;
      if (asJson) jsonResults.push({ file: filePath, ok: false, error: e.message });
      else process.stderr.write(err(`✗ ${path.basename(filePath)}: ${e.message}`) + "\n");
      continue;
    }

    if (asJson) {
      jsonResults.push({ file: filePath, ...result });
    } else if (single) {
      process.stdout.write((result?.text || "").trim() + "\n");
    } else {
      // Bulk text: a header per file so a folder run stays readable.
      process.stdout.write("\n" + head(`── ${path.basename(filePath)} ──`) + "\n");
      process.stdout.write((result?.text || "").trim() + "\n");
    }
  }

  if (asJson) {
    process.stdout.write(JSON.stringify(single ? jsonResults[0] : jsonResults, null, 2) + "\n");
  }
  if (failures) process.exitCode = 1;
}
