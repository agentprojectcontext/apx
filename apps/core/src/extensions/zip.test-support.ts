// Builds .apxext archives for tests, including broken and hostile ones (a lying size, an encrypted flag, a link).
import zlib from "node:zlib";

export type Entry = {
  name: string;
  data?: string | Buffer;
  /** Unix mode in the high bits of the external attributes (a link is 0o120777). */
  mode?: number;
  flags?: number;
  /** Declared unpacked size, when it should lie. */
  size?: number;
  /** 0 stored, 8 deflated (default). */
  method?: number;
};

/** A zip of the entries as written, deflated unless told otherwise. */
export function zip(entries: Entry[]): Buffer {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  for (const e of entries) {
    const name = Buffer.from(e.name, "utf8");
    const raw = Buffer.isBuffer(e.data) ? e.data : Buffer.from(e.data ?? "");
    const method = e.method ?? 8;
    const packed = method === 8 ? zlib.deflateRawSync(raw) : raw;
    const size = e.size ?? raw.length;
    const flags = (e.flags ?? 0) | 0x800;
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(flags, 6);
    local.writeUInt16LE(method, 8);
    local.writeUInt32LE(packed.length, 18);
    local.writeUInt32LE(size, 22);
    local.writeUInt16LE(name.length, 26);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE((3 << 8) | 20, 4);
    central.writeUInt16LE(flags, 8);
    central.writeUInt16LE(method, 10);
    central.writeUInt32LE(packed.length, 20);
    central.writeUInt32LE(size, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt32LE(((e.mode ?? 0o100644) << 16) >>> 0, 38);
    central.writeUInt32LE(offset, 42);
    locals.push(local, name, packed);
    centrals.push(central, name);
    offset += 30 + name.length + packed.length;
  }
  const cd = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(cd.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, cd, end]);
}

/** A zip of a name → contents map, as a packer writes it. */
export const zipFiles = (files: Record<string, string | Buffer>, prefix = "") =>
  zip(Object.entries(files).map(([name, data]) => ({ name: `${prefix}${name}`, data })));

/** An index.json in the catalog's contract, listing each (id, version, hash) under `tier`. */
export function catalogOf(listed: { id: string; version: string; hash: string; tier?: string }[], schema = 1) {
  // As the catalog publishes it: one entry per id, with every version it published.
  const ids = [...new Set(listed.map((l) => l.id))];
  return JSON.stringify({
    schema,
    entries: ids.map((id) => ({
      kind: "extension",
      id,
      tier: listed.find((l) => l.id === id)?.tier ?? "official",
      unknown_field: true,
      versions: listed
        .filter((l) => l.id === id)
        .map((l) => ({ version: l.version, content_hash: l.hash, apx: "2.0.0" })),
    })),
  });
}
