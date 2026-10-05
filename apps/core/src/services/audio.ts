// Speech as a Telegram voice note: OGG/Opus, converted with the ffmpeg on this machine. Without ffmpeg the audio goes
// as a plain audio file instead.
import { spawn } from "node:child_process";

const CONVERT_MS = 60_000;

export function toOggOpus(input: Buffer): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const p = spawn(
      "ffmpeg",
      ["-hide_banner", "-loglevel", "error", "-i", "pipe:0", "-c:a", "libopus", "-b:a", "32k", "-f", "ogg", "pipe:1"],
      {
        stdio: ["pipe", "pipe", "pipe"],
      },
    );
    const out: Buffer[] = [];
    let err = "";
    const timer = setTimeout(() => p.kill("SIGKILL"), CONVERT_MS);
    p.stdout.on("data", (c: Buffer) => out.push(c));
    p.stderr.on("data", (c: Buffer) => {
      err += c.toString();
    });
    p.on("error", (e) => {
      clearTimeout(timer);
      reject(e);
    });
    p.on("close", (code) => {
      clearTimeout(timer);
      if (code === 0) resolve(Buffer.concat(out));
      else reject(new Error(`ffmpeg: ${err.trim().slice(0, 200) || `exit ${code}`}`));
    });
    p.stdin.end(input);
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

/** The first paragraph of an answer, short enough to listen to. */
export const spokenPart = (text: string, max = 320): string => splitSpoken(text, max).spoken;
