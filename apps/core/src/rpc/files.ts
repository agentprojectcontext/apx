// The owner browsing a project's folder: one level at a time and a file's text, never outside the folder (links
// that point out are left out) and never .git's insides (by any name or case).
import fs from "node:fs";
import path from "node:path";
import { FILE_READ_LIMIT, type FileEntry } from "@apx/protocol";
import type { Store } from "../domain/store.ts";
import { badRequest, notFound } from "../errors.ts";
import { insideReal, real } from "../paths.ts";
import type { Handlers } from "./router.ts";

/** Entries one folder lists at most. */
const MAX_ENTRIES = 500;
/** Never shown, whatever the case or a link's name: .git holds remotes (with tokens, sometimes) and hooks. */
const hidden = (rel: string) => rel.split("/").some((seg) => seg.toLowerCase() === ".git");

function looksBinary(b: Buffer): boolean {
  return b.subarray(0, 8000).includes(0);
}

export function fileHandlers(store: Store) {
  /** The project's folder, and `rel` inside it resolved (refused when it, or what a link points to, leaves it). */
  const locate = (project: string, rel: string) => {
    const p = store.projects.get(project);
    if (!p) throw notFound(`project ${project}`);
    if (!p.path || !p.present) throw badRequest(`${p.name} has no folder on this machine`);
    const clean = (path.sep === "\\" ? rel.replace(/\\/g, "/") : rel).replace(/^\/+/, "");
    const root = real(p.path);
    const abs = real(path.resolve(p.path, clean));
    const inside = path.relative(root, abs).split(path.sep).join("/");
    if (!insideReal(p.path, clean) || hidden(clean) || hidden(inside))
      throw badRequest(`${rel} is outside the project's folder`);
    return { root, abs, rel: clean };
  };

  return {
    "files.tree": ({ project, dir }) => {
      const { root, abs } = locate(project, dir);
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
      return { entries, truncated: more };
    },
    "files.read": ({ project, path: rel }) => {
      const { abs, rel: clean } = locate(project, rel);
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
