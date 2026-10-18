// A chat's kept file (a drawing, an attachment) as a real file in the chat's temp folder, so file and shell tools,
// skills and local MCP servers can use it. The media store under APX's home stays closed to agents.
import fs from "node:fs";
import path from "node:path";
import type { MediaRecord } from "../domain/media.ts";
import type { Store } from "../domain/store.ts";
import { insideReal } from "../paths.ts";
import { scratchDir } from "../tools/folders.ts";

/** The media id APX gives out (a drawing, an attachment, a voice note). */
export const MEDIA_ID = /^med_[0-9a-f]{16}$/;

/** A file of this chat by its id, or why not: a media id from another chat is as unknown as a made-up one. */
export function chatMedia(store: Store, thread: { id: string }, id: string): MediaRecord {
  const m = MEDIA_ID.test(id) ? store.media.get(id) : undefined;
  if (!m || m.thread_id !== thread.id) throw new Error(`${id} is not a file of this chat`);
  if (!fs.existsSync(m.path)) throw new Error(`${id} is no longer on disk`);
  return m;
}

/** The name a kept file goes by: an upload's own, else its id with the stored file's extension. */
export const mediaName = (m: MediaRecord): string =>
  !m.service && m.prompt ? m.prompt : `${m.id}${path.extname(m.path)}`;

/** A file name that stays one file name in any folder. */
const safeName = (name: string) => {
  const n = path
    .basename(name.replaceAll("\\", "/"))
    .replace(/[^a-zA-Z0-9._-]/g, "_")
    .slice(0, 120);
  return n && ![".", ".."].includes(n) ? n : "file";
};

/**
 * Copies a kept file into `<temp folder>/<folder>/<fresh dir>/<name>` and returns that path. A fresh folder per copy:
 * an earlier copy, or a link planted where it would go, is never written through.
 */
export function mediaToTemp(
  store: Store,
  home: string,
  thread: { id: string; parent_id?: string | undefined },
  m: MediaRecord,
  folder = "media",
  name = mediaName(m),
): string {
  const base = scratchDir(store, home, thread);
  const parent = path.join(base, folder);
  fs.mkdirSync(parent, { recursive: true });
  if (fs.lstatSync(parent).isSymbolicLink() || !insideReal(base, parent))
    throw new Error("the temp folder is not usable");
  const dir = fs.mkdtempSync(path.join(parent, `${folder === "media" ? m.id : "upload"}-`));
  const file = path.join(dir, safeName(name));
  if (!insideReal(base, file)) throw new Error("the temp folder is not usable");
  fs.copyFileSync(m.path, file, fs.constants.COPYFILE_EXCL);
  return file;
}
