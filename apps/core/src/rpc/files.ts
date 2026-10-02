// The owner browsing a project's folder: one level at a time and a file's text, never outside the folder (links
// that point out are left out) and never .git's insides.
import fs from "node:fs";
import path from "node:path";
import { FILE_READ_LIMIT, type FileEntry } from "@apx/protocol";
import type { Store } from "../domain/store.ts";
import { badRequest, notFound } from "../errors.ts";
import { insideReal } from "../paths.ts";
import type { Handlers } from "./router.ts";

/** Entries one folder lists at most. */
const MAX_ENTRIES = 500;
const HIDDEN: ReadonlySet<string> = new Set([".git"]);

function looksBinary(b: Buffer): boolean {
  return b.subarray(0, 8000).includes(0);
}

export function fileHandlers(store: Store) {
  /** The project's folder on disk, and the real path of `rel` inside it (refused when it leaves the folder). */
  const locate = (project: string, rel: string) => {
    const p = store.projects.get(project);
    if (!p) throw notFound(`project ${project}`);
    if (!p.path || !p.present) throw badRequest(`${p.name} has no folder on this machine`);
    const clean = rel.replace(/\\/g, "/").replace(/^\/+/, "");
    if (clean.split("/").some((s) => HIDDEN.has(s)) || !insideReal(p.path, clean))
      throw badRequest(`${rel} is outside the project's folder`);
    return { root: p.path, abs: path.resolve(p.path, clean), rel: clean };
  };

  return {
    "files.tree": ({ project, dir }) => {
      const { root, abs } = locate(project, dir);
      let names: fs.Dirent[];
      try {
        names = fs.readdirSync(abs, { withFileTypes: true });
      } catch {
        throw notFound(`folder ${dir || "/"}`);
      }
      const entries: FileEntry[] = [];
      for (const d of names) {
        if (HIDDEN.has(d.name)) continue;
        const full = path.join(abs, d.name);
        const rel = path.relative(root, full).split(path.sep).join("/");
        // A link counts as what it points to, and only while that stays inside the folder.
        if (d.isSymbolicLink() && !insideReal(root, rel)) continue;
        let st: fs.Stats;
        try {
          st = fs.statSync(full);
        } catch {
          continue;
        }
        if (st.isDirectory()) entries.push({ name: d.name, path: rel, kind: "dir" });
        else if (st.isFile()) entries.push({ name: d.name, path: rel, kind: "file", bytes: st.size });
      }
      entries.sort((a, b) => (a.kind === b.kind ? a.name.localeCompare(b.name) : a.kind === "dir" ? -1 : 1));
      return { entries: entries.slice(0, MAX_ENTRIES), truncated: entries.length > MAX_ENTRIES };
    },
    "files.read": ({ project, path: rel }) => {
      const { abs, rel: clean } = locate(project, rel);
      let st: fs.Stats;
      try {
        st = fs.statSync(abs);
      } catch {
        throw notFound(`file ${rel}`);
      }
      if (!st.isFile()) throw badRequest(`${rel} is not a file`);
      const fd = fs.openSync(abs, "r");
      try {
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
