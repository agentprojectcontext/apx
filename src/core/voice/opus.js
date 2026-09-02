// Re-encode synthesized speech into the one container Telegram will render as
// a VOICE NOTE.
//
// This is not a cosmetic detail. `sendVoice` accepts OGG/Opus and nothing
// else; hand it the WAV that Gemini TTS returns (or the MP3 from OpenAI /
// ElevenLabs) and the Bot API either rejects the upload or Telegram shows a
// grey file attachment — which on a phone mounted in a car is unplayable
// without taking your hand off the wheel. So: one conversion, in one place,
// and callers that need a voice note ask for one instead of guessing at
// formats.
//
// ffmpeg is the same dependency the transcription path already relies on, and
// it is reached through envWithPath() for the same reason: a daemon booted by
// launchd inherits a PATH with no Homebrew in it, and every conversion would
// otherwise fail with ENOENT (see core/util/path-env.js).
import fs from "node:fs";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { envWithPath } from "#core/util/path-env.js";
import { ensureTtsTmpDir } from "./tts.js";

const run = promisify(execFile);

// Telegram voice notes are mono and low-bitrate by convention; Opus at 32 kbps
// is transparent for speech and keeps a 20-second note around 80 KB.
const VOICE_BITRATE = "32k";
const VOICE_SAMPLE_RATE = "48000";

/**
 * Convert `sourcePath` to OGG/Opus and return the new path. A file that is
 * already .ogg is returned untouched — every engine that emits Opus natively
 * (ElevenLabs' ogg formats, Gemini when it answers audio/ogg) skips the
 * re-encode entirely.
 *
 * Returns `null` when ffmpeg is unavailable or fails, so callers can fall back
 * to plain text rather than dropping the reply. A voice note is an upgrade;
 * losing the message because the upgrade failed is not acceptable.
 */
export async function toVoiceNote(sourcePath) {
  if (!sourcePath || !fs.existsSync(sourcePath)) return null;
  if (path.extname(sourcePath).toLowerCase() === ".ogg") return sourcePath;

  const target = path.join(
    ensureTtsTmpDir(),
    `${path.basename(sourcePath, path.extname(sourcePath))}.ogg`
  );
  try {
    await run(
      "ffmpeg",
      [
        "-hide_banner", "-loglevel", "error", "-y",
        "-i", sourcePath,
        "-vn",
        "-ac", "1",
        "-ar", VOICE_SAMPLE_RATE,
        "-c:a", "libopus",
        "-b:a", VOICE_BITRATE,
        target,
      ],
      { env: envWithPath(), timeout: 60_000 }
    );
  } catch {
    return null;
  }
  return fs.existsSync(target) && fs.statSync(target).size > 0 ? target : null;
}
