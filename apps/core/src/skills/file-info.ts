import { createHash } from "node:crypto";
import fs from "node:fs";
import { parseFrontmatter, textField } from "../apc/frontmatter.ts";

type Stamp = { dev: bigint; ino: bigint; size: bigint; mtimeNs: bigint; ctimeNs: bigint };
type Info = Readonly<{ name: string | undefined; description: string; hash: string }>;
type Entry = { signature: string; info: Info; weight: number };

const signature = (s: Stamp) => `${s.dev}:${s.ino}:${s.size}:${s.mtimeNs}:${s.ctimeNs}`;
// Header substrings must not keep the whole skill's backing string alive.
const detached = (value: string) => Buffer.from(value, "utf8").toString("utf8");

/** Bounded metadata only; every lookup revalidates file identity and timestamps, never skill permissions. */
export function createSkillFileReader(
  options: {
    read?: (file: string) => string;
    stat?: (file: string) => Stamp;
    maxEntries?: number;
    maxBytes?: number;
  } = {},
) {
  const read = options.read ?? ((file: string) => fs.readFileSync(file, "utf8"));
  const stat = options.stat ?? ((file: string) => fs.statSync(file, { bigint: true }));
  const maxEntries = options.maxEntries ?? 512;
  const maxBytes = options.maxBytes ?? 512 * 1024;
  const cache = new Map<string, Entry>();
  let bytes = 0;
  const forget = (key: string) => {
    const entry = cache.get(key);
    if (entry) bytes -= entry.weight;
    cache.delete(key);
  };
  return (file: string): Info => {
    const before = stat(file);
    const key = `${before.dev}:${before.ino}`;
    const stamp = signature(before);
    const cached = before.ino !== 0n ? cache.get(key) : undefined;
    if (cached?.signature === stamp) {
      cache.delete(key);
      cache.set(key, cached);
      return cached.info;
    }
    if (cached) forget(key);
    const text = read(file);
    const { fields } = parseFrontmatter(text);
    const name = textField(fields.name);
    const info: Info = Object.freeze({
      name: name === undefined ? undefined : detached(name),
      description: detached((textField(fields.description) ?? "").replace(/\s+/g, " ").trim()),
      hash: createHash("sha256").update(text).digest("hex"),
    });
    const weight = 2 * ((info.name?.length ?? 0) + info.description.length + stamp.length + key.length + 64) + 256;
    if (before.ino !== 0n && maxEntries > 0 && weight <= maxBytes && signature(stat(file)) === stamp) {
      while (cache.size >= maxEntries || bytes + weight > maxBytes) {
        const oldest = cache.keys().next().value;
        if (oldest === undefined) break;
        forget(oldest);
      }
      cache.set(key, { signature: stamp, info, weight });
      bytes += weight;
    }
    return info;
  };
}

export const skillFileInfo = createSkillFileReader();
