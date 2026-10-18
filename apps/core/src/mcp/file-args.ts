// An agent's own files in an MCP tool's arguments: `apx-file:<path>` or a med_ id of its chat becomes what the field
// takes, base64 for a server elsewhere and a real path for one on this machine. See DECISIONS.md#d-107
import fs from "node:fs";
import type { Store } from "../domain/store.ts";
import { mimeOf } from "../services/attachment-files.ts";
import { chatMedia, MEDIA_ID, mediaName, mediaToTemp } from "../services/media-temp.ts";
import { type FolderThread, folderAccess } from "../tools/folders.ts";

export const FILE_REF = "apx-file:";

/** Largest file sent inline: the same cap as a chat attachment, whatever a server claims to take. */
export const INLINE_MAX_BYTES = 20 * 1024 * 1024;

/** A file an agent may hand on. `path()` is a real path on this machine (a kept file is copied to the temp folder). */
export type AgentFile = { name: string; mime: string; bytes: number; read(): Buffer; path(): string };
export type OpenFile = (ref: string) => AgentFile;

type Json = Record<string, unknown>;
type Form = "base64" | "data-url" | "url" | "path";

const asObj = (v: unknown): Json | undefined =>
  v && typeof v === "object" && !Array.isArray(v) ? (v as Json) : undefined;

/** The file a value names: `apx-file:<path or med_ id>`, or a bare med_ id. */
export function refOf(v: unknown): string | undefined {
  if (typeof v !== "string") return undefined;
  if (v.startsWith(FILE_REF)) return v.slice(FILE_REF.length).trim() || undefined;
  return MEDIA_ID.test(v) ? v : undefined;
}

export function hasFileRefs(v: unknown): boolean {
  if (refOf(v)) return true;
  if (Array.isArray(v)) return v.some(hasFileRefs);
  const o = asObj(v);
  return o ? Object.values(o).some(hasFileRefs) : false;
}

/** Every reference in the arguments, once each. */
export function fileRefs(v: unknown, out = new Set<string>()): string[] {
  const ref = refOf(v);
  if (ref) out.add(ref);
  else if (Array.isArray(v)) for (const x of v) fileRefs(x, out);
  else for (const x of Object.values(asObj(v) ?? {})) fileRefs(x, out);
  return [...out];
}

/** A schema and its anyOf/oneOf/allOf alternatives. */
const branches = (s: Json | undefined): Json[] =>
  s
    ? [
        s,
        ...(["anyOf", "oneOf", "allOf"] as const).flatMap((k) =>
          Array.isArray(s[k]) ? (s[k] as unknown[]).map(asObj).filter((b): b is Json => !!b) : [],
        ),
      ]
    : [];
const propsOf = (s: Json | undefined): Json =>
  Object.assign(
    {},
    ...branches(s)
      .map((b) => asObj(b.properties) ?? {})
      .reverse(),
  );
const propOf = (s: Json | undefined, key: string) => asObj(propsOf(s)[key]);
const itemsOf = (s: Json | undefined) =>
  branches(s)
    .map((b) => asObj(b.items))
    .find(Boolean);

const aboutOf = (s: Json | undefined) =>
  branches(s)
    .flatMap((b) => [b.description, b.title])
    .filter((x): x is string => typeof x === "string")
    .join(" ")
    .toLowerCase();

/** What a field takes, from its name first and its description next. */
export function formOf(key: string, s: Json | undefined, remote: boolean): Form {
  const name = key.toLowerCase();
  const about = aboutOf(s);
  const dataUrl = /data[ _-]?ur[il]/.test(about) && !/\b(no|not|without|never)\b[^.]{0,16}data[ _-]?ur[il]/.test(about);
  const encoded = (dataUrl ? "data-url" : "base64") as Form;
  if (/base64|b64/.test(name) || branches(s).some((b) => b.contentEncoding === "base64")) return encoded;
  if (/(^|_)(url|uri|link)s?$/.test(name) || branches(s).some((b) => b.format === "uri" || b.format === "url"))
    return "url";
  if (/(^|_)(path|filepath|file_path|local_path)s?$/.test(name)) return "path";
  if (/base64/.test(about) || dataUrl) return encoded;
  if (/\bpath\b/.test(about)) return "path";
  return remote ? encoded : "path";
}

/** The smallest size a field's description allows ("under 8 MB"), within INLINE_MAX_BYTES. */
export function limitOf(s: Json | undefined): number {
  const units: Record<string, number> = { kb: 1024, kib: 1024, mb: 1024 ** 2, mib: 1024 ** 2, gb: 1024 ** 3 };
  const said = [...aboutOf(s).matchAll(/(\d+(?:\.\d+)?)\s*(kb|kib|mb|mib|gb)\b/g)].map(
    (m) => Number(m[1]) * (units[m[2] as string] ?? 1),
  );
  return Math.min(INLINE_MAX_BYTES, ...said);
}

const MIME_KEY = /^(mime|mime_?type|content_?type|media_?type)$/i;
const NAME_KEY = /^(file_?name|filename)$/i;
const mb = (n: number) => `${(n / 1024 / 1024).toFixed(n < 1024 * 1024 ? 2 : 1)} MB`;

/**
 * The arguments with each file reference replaced by what its field takes. A field that only takes a public URL,
 * or a path a server elsewhere would read, is refused with what to use instead.
 */
export function fillFileArgs(args: Json, schema: unknown, o: { remote: boolean; open: OpenFile }): Json {
  const convert = (
    ref: string,
    key: string,
    field: Json | undefined,
    parent: Json | undefined,
  ): [unknown, AgentFile] => {
    const file = o.open(ref);
    const form = formOf(key, field, o.remote);
    const encodedSibling = () =>
      Object.entries(propsOf(parent)).find(
        ([k, v]) => k !== key && ["base64", "data-url"].includes(formOf(k, asObj(v), true)),
      )?.[0];
    if (form === "url") {
      const other = encodedSibling();
      throw new Error(
        `${key} takes a public link, and APX does not publish the owner's files: ${other ? `give the file in ${other} instead` : "the server needs its own way to receive a file (an upload link or a base64 field)"}`,
      );
    }
    if (form === "path") {
      if (!o.remote) return [file.path(), file];
      const other = encodedSibling();
      throw new Error(
        `${key} is read by the server, which runs elsewhere and cannot see this computer's files: ${other ? `give the file in ${other} instead` : "this tool has no field that takes the file's contents"}`,
      );
    }
    const limit = limitOf(field);
    if (file.bytes > limit)
      throw new Error(
        `${file.name} is ${mb(file.bytes)}, over the ${mb(limit)} ${key} takes: a file this size needs a link the server fetches or its own upload`,
      );
    const data = file.read().toString("base64");
    const value = form === "data-url" ? `data:${file.mime};base64,${data}` : data;
    const max = branches(field)
      .map((b) => b.maxLength)
      .find((n): n is number => typeof n === "number");
    if (max !== undefined && value.length > max)
      throw new Error(`${file.name} is too big for ${key} (${value.length} characters encoded, at most ${max})`);
    return [value, file];
  };

  const walk = (value: unknown, key: string, field: Json | undefined, parent: Json | undefined): unknown => {
    const ref = refOf(value);
    if (ref) return convert(ref, key, field, parent)[0];
    if (Array.isArray(value)) return value.map((v) => walk(v, key, itemsOf(field), parent));
    const obj = asObj(value);
    return obj ? object(obj, field) : value;
  };

  const object = (obj: Json, s: Json | undefined): Json => {
    const out: Json = {};
    const files: AgentFile[] = [];
    for (const [k, v] of Object.entries(obj)) {
      const ref = refOf(v);
      if (ref) {
        const [value, file] = convert(ref, k, propOf(s, k), s);
        out[k] = value;
        files.push(file);
      } else out[k] = walk(v, k, propOf(s, k), s);
    }
    // One file in this object: the type and name fields the schema has, and the agent left empty, describe it.
    const [only] = files;
    if (files.length === 1 && only)
      for (const k of Object.keys(propsOf(s)))
        if (out[k] === undefined && MIME_KEY.test(k)) out[k] = only.mime;
        else if (out[k] === undefined && NAME_KEY.test(k)) out[k] = only.name;
    return out;
  };

  return object(args, asObj(schema));
}

/** The files an agent of `thread` may hand on: a path in its folders, or a kept file of its chat. */
export function agentFiles(store: Store, home: string, thread: FolderThread & { id: string }): OpenFile {
  return (ref) => {
    if (MEDIA_ID.test(ref)) {
      const m = chatMedia(store, thread, ref);
      return {
        name: mediaName(m),
        mime: m.mime,
        bytes: m.bytes,
        read: () => fs.readFileSync(m.path),
        path: () => mediaToTemp(store, home, thread, m),
      };
    }
    const r = folderAccess(store, home, thread, ref);
    if ("refused" in r) throw new Error(`refused: ${r.refused}`);
    if (r.at.split(/[\\/]/).includes(".git")) throw new Error("refused: the .git folder is off limits");
    const stat = fs.statSync(r.at, { throwIfNoEntry: false });
    if (!stat?.isFile()) throw new Error(`${ref} ${stat ? "is not a file" : "does not exist"}`);
    const name = r.at.split(/[\\/]/).at(-1) ?? "file";
    return {
      name,
      mime: mimeOf(name),
      bytes: stat.size,
      read: () => {
        const bytes = fs.readFileSync(r.at);
        if (bytes.length !== stat.size) throw new Error(`${ref} changed while it was read; try again`);
        return bytes;
      },
      path: () => r.at,
    };
  };
}
