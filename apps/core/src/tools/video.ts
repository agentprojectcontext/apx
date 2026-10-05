// video_transcript: what a video says, without a browser: its title, description and captions through yt-dlp
// (YouTube, Vimeo and most video sites). Nothing is downloaded or written; offered only where yt-dlp is installed.
import { execFile } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { z } from "zod";
import { untrusted } from "./result.ts";
import { defineTool, type Tool } from "./types.ts";

/** Where a package manager puts programs, for a core started without the login shell's PATH (launchd, systemd). */
const USUAL_DIRS = ["/opt/homebrew/bin", "/usr/local/bin", "/usr/bin", "/home/linuxbrew/.linuxbrew/bin"];

export function findProgram(name: string, envPath = process.env.PATH ?? ""): string | undefined {
  for (const dir of [...envPath.split(path.delimiter), ...USUAL_DIRS].filter(Boolean)) {
    const file = path.join(dir, name);
    try {
      fs.accessSync(file, fs.constants.X_OK);
      return file;
    } catch {}
  }
  return undefined;
}

type Track = { ext?: string; url?: string };
type Info = {
  title?: string;
  uploader?: string;
  duration?: number;
  upload_date?: string;
  description?: string;
  webpage_url?: string;
  language?: string;
  subtitles?: Record<string, Track[]>;
  automatic_captions?: Record<string, Track[]>;
};

/** A site's own page for a video, never this machine or a private network: yt-dlp would fetch whatever it is given. */
export function publicVideoUrl(raw: string): boolean {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return false;
  }
  if (u.protocol !== "https:" && u.protocol !== "http:") return false;
  const host = u.hostname.toLowerCase();
  return (
    host.includes(".") &&
    !/^[\d.]+$/.test(host) &&
    !host.includes(":") &&
    !/(^|\.)(localhost|local|internal)$/.test(host)
  );
}

/** The captions to read: the uploader's own in the asked language, then any of theirs, then the automatic ones. */
function pickTrack(info: Info, lang: string): { lang: string; url: string; auto: boolean } | undefined {
  const vtt = (tracks: Track[] | undefined) => tracks?.find((t) => t.ext === "vtt" && t.url)?.url;
  const own = info.subtitles ?? {};
  const auto = info.automatic_captions ?? {};
  const spoken = info.language ?? "";
  const order: Array<[Record<string, Track[]>, string, boolean]> = [
    [own, lang, false],
    [own, spoken, false],
    ...Object.keys(own).map((k): [Record<string, Track[]>, string, boolean] => [own, k, false]),
    [auto, `${spoken}-orig`, true],
    [auto, spoken, true],
    [auto, lang, true],
    [auto, "en", true],
  ];
  for (const [tracks, key, isAuto] of order) {
    const url = key ? vtt(tracks[key]) : undefined;
    if (url) return { lang: key, url, auto: isAuto };
  }
  return undefined;
}

const clock = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;

/** WebVTT as paragraphs of about 30 s, each with its time mark; automatic captions repeat each line as it scrolls. */
export function vttText(vtt: string): string {
  const out: string[] = [];
  let at = 0;
  let marked = -Infinity;
  let last = "";
  for (const line of vtt.replace(/\r/g, "").split("\n")) {
    const cue = /^(\d+):(\d\d):(\d\d)[.,]\d+\s+-->/.exec(line) ?? /^(\d\d):(\d\d)[.,]\d+\s+-->/.exec(line);
    if (cue) {
      const n = cue.slice(1).map(Number);
      at = n.length === 3 ? (n[0] ?? 0) * 3600 + (n[1] ?? 0) * 60 + (n[2] ?? 0) : (n[0] ?? 0) * 60 + (n[1] ?? 0);
      continue;
    }
    if (!line.trim() || /^(WEBVTT|Kind:|Language:|NOTE\b|\d+$)/.test(line.trim())) continue;
    const text = line
      .replace(/<[^>]+>/g, "")
      .replace(/&nbsp;/g, " ")
      .replace(/&amp;/g, "&")
      .trim();
    if (!text || text === last) continue;
    last = text;
    if (at - marked >= 30 || !out.length) {
      out.push(`[${clock(at)}] ${text}`);
      marked = at;
    } else out[out.length - 1] += ` ${text}`;
  }
  return out.join("\n");
}

function ytDlp(bin: string, url: string, signal: AbortSignal): Promise<Info> {
  return new Promise((resolve, reject) => {
    execFile(
      bin,
      ["--dump-json", "--no-playlist", "--skip-download", "--no-warnings", "--", url],
      {
        signal,
        timeout: 60_000,
        maxBuffer: 32 * 1024 * 1024,
        env: { PATH: process.env.PATH ?? "", HOME: process.env.HOME ?? "" },
      },
      (err, stdout, stderr) => {
        if (err) return reject(new Error((stderr || err.message).trim().split("\n").at(-1)?.slice(0, 300)));
        try {
          resolve(JSON.parse(stdout) as Info);
        } catch {
          reject(new Error("yt-dlp gave no readable answer"));
        }
      },
    );
  });
}

export function videoTools(bin: string | undefined): Tool[] {
  if (!bin) return [];
  return [
    defineTool({
      name: "video_transcript",
      description:
        "What a video says, without a browser: title, channel, length, description and its captions as text with time marks (YouTube, Vimeo and most video sites). Use it to watch, summarize or analyze a video from a link.",
      args: z.object({
        url: z.string().min(8).max(2000),
        lang: z.string().max(12).optional().describe("Captions language to prefer (es, en…); default the video's own."),
      }),
      effect: "external",
      confirm: "untrusted",
      deadlineMs: 120_000,
      title: (a) => `Watched ${String(a.url ?? "").slice(0, 80)}`,
      async run(a, ctx) {
        if (!publicVideoUrl(a.url)) return "refused: give the video's page on a public site (https://…)";
        const info = await ytDlp(bin, a.url, ctx.signal);
        const track = pickTrack(info, a.lang ?? "");
        let transcript = "(this video has no captions: answer from the title and description, and say so)";
        if (track) {
          const res = await fetch(track.url, { signal: AbortSignal.any([ctx.signal, AbortSignal.timeout(30_000)]) });
          if (res.ok) transcript = vttText(await res.text()) || transcript;
        }
        const head = [
          info.title,
          info.uploader ? `by ${info.uploader}` : "",
          info.duration ? `${clock(info.duration)} long` : "",
          info.upload_date ? `published ${info.upload_date}` : "",
          info.webpage_url ?? a.url,
        ]
          .filter(Boolean)
          .join(" · ");
        const body = [
          head,
          info.description ? `Description:\n${info.description.slice(0, 2000)}` : "",
          `Transcript${track ? ` (${track.lang}${track.auto ? ", automatic captions" : ""})` : ""}:\n${transcript}`,
        ]
          .filter(Boolean)
          .join("\n\n");
        return untrusted("video", { url: info.webpage_url ?? a.url }, body);
      },
    }),
  ];
}
