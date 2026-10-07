// The owner browsing a project's folder or a chat's: one level at a time and a file's text, never outside the folder
// (links that point out are left out) and never .git's insides (by any name or case).
import fs from "node:fs";
import path from "node:path";
import { FILE_MEDIA_LIMIT, FILE_READ_LIMIT, type FileEntry } from "@apx/protocol";
import type { DesktopOps } from "../desktop.ts";
import type { Store } from "../domain/store.ts";
import { gitDiff, gitStatus } from "../engine/changes.ts";
import { badRequest, notFound } from "../errors.ts";
import { insideReal, real } from "../paths.ts";
import { scratchDir, workDir } from "../tools/shell.ts";
import { reportedDiff } from "./reported-diff.ts";
import type { Handlers } from "./router.ts";

/** Entries one folder lists at most. */
const MAX_ENTRIES = 500;
/** Never shown, whatever the case or a link's name: .git holds remotes (with tokens, sometimes) and hooks. */
const hidden = (rel: string) => rel.split("/").some((seg) => seg.toLowerCase() === ".git");

function looksBinary(b: Buffer): boolean {
  return b.subarray(0, 8000).includes(0);
}

/** What the viewer can show, by extension. */
const MEDIA: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  svg: "image/svg+xml",
  avif: "image/avif",
  mp4: "video/mp4",
  webm: "video/webm",
  mov: "video/quicktime",
  mp3: "audio/mpeg",
  wav: "audio/wav",
  ogg: "audio/ogg",
  m4a: "audio/mp4",
  pdf: "application/pdf",
};
export const mediaType = (name: string) => MEDIA[name.split(".").pop()?.toLowerCase() ?? ""];

/** The folder a chat works in: a code session's own, its project's, or else APX's work folder. */
export function threadFolder(store: Store, home: string, threadId: string): string {
  const t = store.threads.get(threadId);
  if (!t) throw notFound(`thread ${threadId}`);
  return workDir(store, home, t);
}

type Where = { project?: string | undefined; thread?: string | undefined; scratch?: boolean | undefined };

export function fileHandlers(store: Store, desktop: DesktopOps, home: string) {
  /** The folder browsed: a project's, or a chat's (APX's work folder is made when first opened, as an agent would). */
  const baseOf = ({ project, thread, scratch }: Where) => {
    if (thread && scratch) {
      const t = store.threads.get(thread);
      if (!t) throw notFound(`thread ${thread}`);
      const dir = scratchDir(store, home, t);
      fs.mkdirSync(dir, { recursive: true });
      return dir;
    }
    if (scratch) throw badRequest("a temp folder is a chat's");
    if (thread) {
      const dir = threadFolder(store, home, thread);
      if (dir === path.join(home, "work")) fs.mkdirSync(dir, { recursive: true });
      return dir;
    }
    if (!project) throw badRequest("a project or a chat");
    const p = store.projects.get(project);
    if (!p) throw notFound(`project ${project}`);
    if (!p.path || !p.present) throw badRequest(`${p.name} has no folder on this machine`);
    return p.path;
  };

  /** The folder, and `rel` inside it resolved (refused when it, or what a link points to, leaves it). */
  const locate = (where: Where, rel: string) => {
    const base = baseOf(where);
    const clean = (path.sep === "\\" ? rel.replace(/\\/g, "/") : rel).replace(/^\/+/, "");
    const root = real(base);
    const abs = real(path.resolve(base, clean));
    const inside = path.relative(root, abs).split(path.sep).join("/");
    if (!insideReal(base, clean) || hidden(clean) || hidden(inside)) throw badRequest(`${rel} is outside the folder`);
    return { root, abs, rel: clean };
  };

  const folderOf = (threadId: string) => threadFolder(store, home, threadId);

  return {
    "files.changes": async ({ thread }) => {
      const cwd = folderOf(thread);
      const files = await gitStatus(cwd);
      return { cwd, git: files !== undefined, files: (files ?? []).filter((f) => !hidden(f.path)) };
    },
    "files.diff": async (params) => {
      if (params.message) return reportedDiff(store, home, params);
      const { thread, path: rel } = params;
      const cwd = folderOf(thread);
      if (!insideReal(cwd, rel) || hidden(rel) || path.isAbsolute(rel))
        throw badRequest(`${rel} is outside the folder`);
      return { path: rel, ...(await gitDiff(cwd, rel)) };
    },
    "files.tree": ({ dir, ...where }) => {
      const { root, abs } = locate(where, dir);
      let folder: fs.Dir;
      try {
        folder = fs.opendirSync(abs);
      } catch {
        throw notFound(`folder ${dir || "/"}`);
      }
      const entries: FileEntry[] = [];
      let more = false;
      try {
        // Reads only what it shows (and one more, to know there is more): a huge folder does not hold the core.
        for (let d = folder.readSync(); d; d = folder.readSync()) {
          if (entries.length >= MAX_ENTRIES) {
            more = true;
            break;
          }
          const full = path.join(abs, d.name);
          const rel = path.relative(root, full).split(path.sep).join("/");
          if (hidden(rel)) continue;
          // A link counts as what it points to, and only while that stays inside the folder (and is not .git).
          if (d.isSymbolicLink() && (!insideReal(root, rel) || hidden(path.relative(root, real(full))))) continue;
          let st: fs.Stats;
          try {
            st = fs.statSync(full);
          } catch {
            continue;
          }
          if (st.isDirectory()) entries.push({ name: d.name, path: rel, kind: "dir" });
          else if (st.isFile()) entries.push({ name: d.name, path: rel, kind: "file", bytes: st.size });
        }
      } finally {
        folder.closeSync();
      }
      entries.sort((a, b) => (a.kind === b.kind ? a.name.localeCompare(b.name) : a.kind === "dir" ? -1 : 1));
      return { root, entries, truncated: more };
    },
    "files.media": ({ path: rel, ...where }) => {
      const { abs, rel: clean } = locate(where, rel);
      const mime = mediaType(clean);
      if (!mime) throw badRequest(`${rel} is not an image, video, audio or PDF`);
      let fd: number;
      try {
        fd = fs.openSync(abs, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK);
      } catch {
        throw notFound(`file ${rel}`);
      }
      try {
        const st = fs.fstatSync(fd);
        if (!st.isFile()) throw badRequest(`${rel} is not a file`);
        if (st.size > FILE_MEDIA_LIMIT) throw badRequest(`${rel} is too big to preview; open it from Finder`);
        const buf = Buffer.alloc(st.size);
        fs.readSync(fd, buf, 0, st.size, 0);
        return { mime, data: buf.toString("base64"), bytes: st.size };
      } finally {
        fs.closeSync(fd);
      }
    },
    "files.reveal": async ({ path: rel, ...where }) => {
      const { abs } = locate(where, rel);
      if (!fs.existsSync(abs)) throw notFound(`file ${rel}`);
      await desktop.reveal(abs);
      return { ok: true as const };
    },
    "files.rename": ({ path: rel, name, ...where }) => {
      const { abs, root, rel: clean } = locate(where, rel);
      if (!clean) throw badRequest("the folder itself is renamed from Finder");
      const next = locate(where, path.posix.join(path.posix.dirname(clean), name));
      if (!fs.existsSync(abs)) throw notFound(`file ${rel}`);
      if (fs.existsSync(next.abs)) throw badRequest(`${name} already exists there`);
      fs.renameSync(abs, next.abs);
      return { path: path.relative(root, next.abs).split(path.sep).join("/") };
    },
    "files.keep": ({ thread, path: rel }) => {
      const from = locate({ thread, scratch: true }, rel);
      if (!from.rel) throw badRequest("pick a file or folder inside the temp folder");
      if (!fs.existsSync(from.abs)) throw notFound(`file ${rel}`);
      const to = locate({ thread }, "");
      const ext = path.extname(from.abs);
      const stem = path.basename(from.abs, ext);
      let name = path.basename(from.abs);
      for (let i = 2; fs.existsSync(path.join(to.abs, name)); i++) name = `${stem} ${i}${ext}`;
      const dest = locate({ thread }, name);
      // Links are left behind: one planted in the temp folder must not carry somewhere else into the project.
      fs.cpSync(from.abs, dest.abs, {
        recursive: true,
        errorOnExist: true,
        force: false,
        filter: (src) => !fs.lstatSync(src).isSymbolicLink(),
      });
      return { path: dest.rel };
    },
    "files.trash": async ({ path: rel, ...where }) => {
      const { abs, rel: clean } = locate(where, rel);
      if (!clean) throw badRequest("the folder itself is never moved to the trash");
      if (!fs.existsSync(abs)) throw notFound(`file ${rel}`);
      await desktop.trash(abs);
      return { ok: true as const };
    },
    "files.read": ({ path: rel, ...where }) => {
      const { abs, rel: clean } = locate(where, rel);
      let fd: number;
      try {
        // The resolved path, not following a link swapped in since the check; never waiting on a pipe.
        fd = fs.openSync(abs, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK);
      } catch {
        throw notFound(`file ${rel}`);
      }
      try {
        const st = fs.fstatSync(fd);
        if (!st.isFile()) throw badRequest(`${rel} is not a file`);
        const buf = Buffer.alloc(Math.min(st.size, FILE_READ_LIMIT));
        const n = fs.readSync(fd, buf, 0, buf.length, 0);
        const head = buf.subarray(0, n);
        if (looksBinary(head)) return { path: clean, bytes: st.size, binary: true, truncated: false };
        return { path: clean, bytes: st.size, binary: false, truncated: st.size > n, text: head.toString("utf8") };
      } finally {
        fs.closeSync(fd);
      }
    },
  } satisfies Partial<Handlers>;
}
