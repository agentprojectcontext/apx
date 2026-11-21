import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { ContactSource, ContactSourceUpdate } from "@apx/protocol";
import { z } from "zod";
import { badRequest, conflict } from "../errors.ts";
import { isInside, realpath, samePath } from "../paths.ts";
import type { Store } from "./store.ts";

const SavedSource = ContactSource.extend({ root: z.string() });
export type Source = z.infer<typeof SavedSource>;
export type SourceUpdate = z.infer<typeof ContactSourceUpdate>;
const State = z.object({ sources: z.array(SavedSource), updates: z.array(ContactSourceUpdate) });
const KEY = "contact_document_sources";
export const SOURCE_MAX_BYTES = 400_000;
export const sourceHash = (text: string) => createHash("sha256").update(text).digest("hex");

export function sourceState(store: Store) {
  return State.parse(JSON.parse(store.settings.get(KEY) ?? '{"sources":[],"updates":[]}'));
}
export function saveSources(store: Store, value: z.infer<typeof State>) {
  store.settings.set(KEY, JSON.stringify(value));
}
export function sourceBound(store: Store, source: Source) {
  const person = store.persons.get(source.person);
  const agent = store.agents.get(source.agent);
  return person?.role === "contact" && person.agent_id === source.agent && agent?.project_id === source.project;
}

/** A grant pins the folder and reviewed bytes; a replaced document is unavailable until reviewed again. */
export function readSource(store: Store, source: Source) {
  try {
    return read(store, source);
  } catch {
    throw conflict("authorized document is unavailable or changed; ask the owner to review it again");
  }
}
function read(store: Store, source: Source) {
  const project = store.projects.get(source.project);
  if (!project?.path || !project.present || !samePath(realpath(project.path), source.root))
    throw conflict("source folder changed");
  const at = path.resolve(source.root, source.path);
  if (!isInside(source.root, at) || !samePath(realpath(at), at)) throw conflict("source location changed");
  const before = fs.statSync(at);
  const fd = fs.openSync(at, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK);
  try {
    const stat = fs.fstatSync(fd);
    if (!stat.isFile() || stat.size > SOURCE_MAX_BYTES || stat.ino !== before.ino || stat.dev !== before.dev)
      throw badRequest("source must be stable bounded text");
    const bytes = Buffer.alloc(stat.size + 1);
    let size = 0;
    while (size < bytes.length) {
      const n = fs.readSync(fd, bytes, size, bytes.length - size, size);
      if (!n) break;
      size += n;
    }
    if (
      size !== stat.size ||
      bytes.subarray(0, size).includes(0) ||
      !samePath(realpath(at), at) ||
      !samePath(realpath(project.path), source.root)
    )
      throw conflict("source changed");
    const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes.subarray(0, size));
    return { text, revision: sourceHash(text), at, mode: stat.mode };
  } finally {
    fs.closeSync(fd);
  }
}
