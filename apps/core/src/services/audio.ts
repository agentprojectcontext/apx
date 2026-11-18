// Audio converted with ffmpeg (`bin`: this computer's or the one APX downloaded, see ffmpeg.ts): speech as a Telegram
// voice note (OGG/Opus; without ffmpeg the audio goes as a plain audio file instead), and recordings as the 16 kHz
// audio APX's own voice and whisper.cpp transcribe.
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const CONVERT_MS = 60_000;

export const toOggOpus = (input: Buffer, bin = "ffmpeg", run = spawn) =>
  convert(input, ["-c:a", "libopus", "-b:a", "32k", "-f", "ogg"], bin, run);

/** Any recording as 16 kHz mono 16-bit PCM: what APX's own voice transcribes. */
export const toPcm16k = (input: Buffer, bin = "ffmpeg", run = spawn) =>
  convert(input, ["-ac", "1", "-ar", "16000", "-f", "s16le"], bin, run);

/** A service's reply in the call socket's 24 kHz mono PCM16 format. */
export const toPcm24k = (input: Buffer, bin = "ffmpeg", run = spawn) =>
  convert(input, ["-ac", "1", "-ar", "24000", "-f", "s16le"], bin, run);

/** Any recording as a 16 kHz mono WAV: what whisper.cpp reads without converting it itself. */
export const toWav16k = async (input: Buffer, bin = "ffmpeg", run = spawn) => wav16k(await toPcm16k(input, bin, run));

/** 16 kHz mono 16-bit PCM with its WAV header (the header is written here: ffmpeg cannot fill it in on a pipe). */
export function wav16k(pcm: Buffer): Buffer {
  const h = Buffer.alloc(44);
  h.write("RIFF", 0);
  h.writeUInt32LE(36 + pcm.length, 4);
  h.write("WAVEfmt ", 8);
  h.writeUInt32LE(16, 16);
  h.writeUInt16LE(1, 20);
  h.writeUInt16LE(1, 22);
  h.writeUInt32LE(16_000, 24);
  h.writeUInt32LE(32_000, 28);
  h.writeUInt16LE(2, 32);
  h.writeUInt16LE(16, 34);
  h.write("data", 36);
  h.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([h, pcm]);
}

/**
 * The input goes through a file: a phone's m4a keeps its index at the end, and ffmpeg reading it from a pipe ends
 * with no sound and no error. Nothing out counts as a failure, so the next engine is tried.
 */
async function convert(input: Buffer, out: string[], bin: string, run: typeof spawn): Promise<Buffer> {
  const dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "apx-audio-"));
  try {
    const file = path.join(dir, "in");
    await fs.promises.writeFile(file, input);
    return await ffmpeg(run, bin, ["-hide_banner", "-loglevel", "error", "-i", file, ...out, "pipe:1"]);
  } finally {
    await fs.promises.rm(dir, { recursive: true, force: true });
  }
}

function ffmpeg(run: typeof spawn, bin: string, args: string[]): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const p = run(bin, args, { stdio: ["ignore", "pipe", "pipe"] });
    const chunks: Buffer[] = [];
    let err = "";
    const timer = setTimeout(() => p.kill("SIGKILL"), CONVERT_MS);
    p.stdout?.on("data", (c: Buffer) => chunks.push(c));
    p.stderr?.on("data", (c: Buffer) => {
      err += c.toString();
    });
    p.on("error", (e) => {
      clearTimeout(timer);
      reject(e);
    });
    p.on("close", (code) => {
      clearTimeout(timer);
      const audio = Buffer.concat(chunks);
      if (code === 0 && audio.length) resolve(audio);
      else
        reject(
          new Error(`ffmpeg: ${err.trim().slice(0, 200) || (code === 0 ? "no sound in the audio" : `exit ${code}`)}`),
        );
    });
  });
}

const plainText = (t: string) =>
  t
    .replace(/[*_`#>]/g, "")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .trim();

/**
 * An answer as a voice note and the rest: the first paragraph that is not code, cut at a sentence end to about `max`
 * characters, becomes what is spoken (plain words, its own transcript); everything else stays as written.
 */
export function splitSpoken(text: string, max = 320): { spoken: string; rest: string } {
  const paragraphs = text.split(/\n\s*\n/);
  const at = paragraphs.findIndex((p) => p.trim() && !p.trim().startsWith("```"));
  if (at < 0) return { spoken: "", rest: text.trim() };
  const raw = (paragraphs[at] ?? "").trim();
  let said = raw;
  if (plainText(raw).length > max) {
    const ends = [...raw.matchAll(/[.?!…](?=\s|$)/g)].map((m) => (m.index ?? 0) + 1);
    const fit = ends.filter((e) => plainText(raw.slice(0, e)).length <= max).at(-1);
    // No sentence end in reach: the whole first sentence, however long, rather than a cut word.
    said = raw.slice(0, fit ?? ends[0] ?? raw.length);
  }
  const left = raw.slice(said.length).trim();
  const rest = [...paragraphs.slice(0, at), left, ...paragraphs.slice(at + 1)]
    .map((p) => p.trim())
    .filter(Boolean)
    .join("\n\n");
  return { spoken: plainText(said), rest };
}
