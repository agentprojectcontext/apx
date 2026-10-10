// apx image / transcribe / say: one-shot media through the core's image, speech and voice services.
import fs from "node:fs";
import path from "node:path";
import { type ApxClient, UPLOAD_LIMITS } from "@apx/protocol/client";

export const USAGE = {
  image: `apx image "<prompt>" [--out file] [--size WxH]   Draw an image with the first image service that answers
                                                  (default file: <media id>.<ext> in this folder)`,
  transcribe: "apx transcribe <audio file>                       Speech to text; prints the words",
  say: `apx say "<text>" [--out file]                     Speak text with the first voice service that answers
                                                  (default file: <media id>.<ext> in this folder)`,
};

const AUDIO_MIME: Record<string, string> = {
  ".mp3": "audio/mpeg",
  ".wav": "audio/wav",
  ".m4a": "audio/mp4",
  ".mp4": "audio/mp4",
  ".ogg": "audio/ogg",
  ".oga": "audio/ogg",
  ".opus": "audio/ogg",
  ".webm": "audio/webm",
  ".flac": "audio/flac",
  ".aac": "audio/aac",
};

/** A file extension for a media type ("image/jpeg" → "jpg", "audio/mpeg" → "mp3"). */
export function extensionOf(mime: string): string {
  const sub = (mime.split("/")[1] ?? "bin").split(/[;+]/)[0] ?? "bin";
  return { jpeg: "jpg", mpeg: "mp3", "x-wav": "wav", wave: "wav" }[sub] ?? sub;
}

/** "1024x768" → width and height. */
export function sizeOf(size: string): { width: number; height: number } {
  const m = /^(\d+)x(\d+)$/i.exec(size.trim());
  if (!m) throw new Error(`--size is WxH, like 1024x768 (got "${size}")`);
  return { width: Number(m[1]), height: Number(m[2]) };
}

/** Fetches a media's bytes from the core and writes them to `out`, or to <id>.<ext> here. */
async function save(client: ApxClient, media: { id: string; mime: string }, out: string | undefined) {
  const { data } = await client.call("media.get", { id: media.id });
  const file = out ?? `${media.id}.${extensionOf(media.mime)}`;
  fs.writeFileSync(file, Buffer.from(data, "base64"));
  return file;
}

const said = (r: { service: string; model?: string | undefined; skipped: string[] }) =>
  `${r.service}${r.model ? ` · ${r.model}` : ""}${r.skipped.length ? `  (skipped: ${r.skipped.join("; ")})` : ""}`;

export async function image(
  client: ApxClient,
  words: string[],
  o: { out?: string | undefined; size?: string | undefined },
) {
  const prompt = words.join(" ").trim();
  if (!prompt || prompt === "help") return help(USAGE.image, !prompt);
  const r = await client.call("media.image", { prompt, ...(o.size ? sizeOf(o.size) : {}) });
  for (const m of r.media) console.log(`${await save(client, m, o.out)}  ${said(r)}`);
}

export async function say(client: ApxClient, words: string[], o: { out?: string | undefined }) {
  const text = words.join(" ").trim();
  if (!text || text === "help") return help(USAGE.say, !text);
  const r = await client.call("media.speak", { text });
  console.log(`${await save(client, r.media, o.out)}  ${said(r)}`);
}

export async function transcribe(client: ApxClient, [file]: string[]) {
  if (!file || file === "help") return help(USAGE.transcribe, !file);
  const mime = AUDIO_MIME[path.extname(file).toLowerCase()];
  if (!mime) throw new Error(`unknown audio type: ${file} (${Object.keys(AUDIO_MIME).join(" ")})`);
  const bytes = fs.readFileSync(file);
  if (bytes.length > UPLOAD_LIMITS.audioBytes)
    throw new Error(`${file} is over ${UPLOAD_LIMITS.audioBytes / 1024 / 1024} MB, the most the core takes`);
  const r = await client.call("media.transcribe", { data: bytes.toString("base64"), mime });
  console.log(r.text);
}

/** `help` prints the usage; no argument at all is a usage error. */
function help(usage: string, missing: boolean) {
  if (missing) throw new Error(usage);
  console.log(usage);
}
