// A video's first frame as a small JPEG, made with the ffmpeg on this machine and kept beside the media: the Files
// screen shows it on the video's card without loading the video. Without ffmpeg there is none, and the card keeps its icon.
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const POSTER_MS = 20_000;
/** Posters made at once: a screen of video cards asks for dozens together. */
const AT_ONCE = 2;

/** Writes one frame of `video` to `out` as a JPEG; rejects when it cannot. */
export type FrameMaker = (video: string, out: string) => Promise<void>;

export const ffmpegFrame: FrameMaker = (video, out) =>
  new Promise((resolve, reject) => {
    // Seeking before -i is fast; 0.5 s skips a black first frame and still fits the shortest clip.
    const args = ["-hide_banner", "-loglevel", "error", "-y", "-ss", "0.5", "-i", video];
    const p = spawn("ffmpeg", [...args, "-frames:v", "1", "-vf", "scale=480:-2", "-q:v", "5", "-f", "image2", out], {
      stdio: ["ignore", "ignore", "pipe"],
    });
    let err = "";
    const timer = setTimeout(() => p.kill("SIGKILL"), POSTER_MS);
    p.stderr.on("data", (c: Buffer) => {
      err += c.toString();
    });
    p.on("error", (e) => {
      clearTimeout(timer);
      reject(e);
    });
    p.on("close", (code) => {
      clearTimeout(timer);
      if (code === 0 && fs.existsSync(out)) resolve();
      else reject(new Error(`ffmpeg: ${err.trim().slice(0, 200) || `exit ${code}`}`));
    });
  });

export function videoPosters(dir: string, make: FrameMaker = ffmpegFrame) {
  const failed = new Set<string>();
  const waiting: Array<() => void> = [];
  let running = 0;
  // The slot is taken before any await, so no more than AT_ONCE pass; a finished one hands its slot to the next.
  const acquire = () => {
    if (running < AT_ONCE) {
      running++;
      return Promise.resolve();
    }
    return new Promise<void>((resolve) => {
      waiting.push(resolve);
    });
  };
  const release = () => {
    const next = waiting.shift();
    if (next) next();
    else running--;
  };
  return {
    /** The poster of media `id` (a video at `video`), made once; undefined when it cannot be made. */
    async of(id: string, video: string): Promise<Buffer | undefined> {
      const out = path.join(dir, `${id}.jpg`);
      if (fs.existsSync(out)) return fs.readFileSync(out);
      if (failed.has(id) || !fs.existsSync(video)) return undefined;
      await acquire();
      try {
        if (!fs.existsSync(out)) {
          fs.mkdirSync(dir, { recursive: true });
          const part = `${out}.${process.pid}.part.jpg`;
          await make(video, part);
          fs.renameSync(part, out);
        }
        return fs.readFileSync(out);
      } catch {
        failed.add(id);
        return undefined;
      } finally {
        release();
      }
    },
  };
}
