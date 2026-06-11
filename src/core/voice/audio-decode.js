// Decode the `audio` field from a voice/turn request into a filesystem path
// the STT layer can read. Three input shapes:
//   - undefined / null  → returns null (caller falls through to text-only)
//   - filesystem path   → returns it as-is (cleanup: false)
//   - base64 (raw or `data:...;base64,...`) → writes to tmp, cleanup: true
//
// `cleanup: true` means the caller must `fs.unlinkSync(decoded.path)` when
// done. Pure helper, no daemon dependencies.
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { randomUUID } from "node:crypto";

const MAX_PATH_LEN = 1024;

export async function decodeAudioInput({ audio, format = "webm" }) {
  if (!audio) return null;
  // A short string that starts with "/" and exists on disk is treated as a
  // path. Anything else is interpreted as base64 (optionally with a data:
  // prefix).
  if (
    typeof audio === "string" &&
    audio.length < MAX_PATH_LEN &&
    audio.startsWith("/") &&
    fs.existsSync(audio)
  ) {
    return { path: audio, cleanup: false };
  }
  let b64 = audio;
  const m = /^data:[^;]+;base64,(.+)$/.exec(b64);
  if (m) b64 = m[1];
  const buf = Buffer.from(b64, "base64");
  if (!buf.length) throw new Error("decodeAudioInput: decoded audio is empty");
  const ext = String(format || "webm").replace(/^\./, "");
  const tmp = path.join(os.tmpdir(), `apx-voice-${Date.now()}-${randomUUID()}.${ext}`);
  fs.writeFileSync(tmp, buf);
  return { path: tmp, cleanup: true };
}
