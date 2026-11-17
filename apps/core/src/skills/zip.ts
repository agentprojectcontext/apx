// Reads a .zip in memory: stored and deflated entries of regular files. Folders are implied by paths; links, unsafe
// paths, encrypted entries and zip64 archives are not read. Writes one the same way, the same bytes for the same files.
import zlib from "node:zlib";

export type ZipFile = { path: string; data: Buffer };
/** `strict`: an entry that would be left out (a link, an unsafe path, encryption, another compression) refuses the archive. */
export type ZipLimits = { entries: number; bytes: number; strict?: boolean };

const EOCD = 0x06054b50;
const CENTRAL = 0x02014b50;
const LOCAL = 0x04034b50;
const UNIX = 3;
const S_IFMT = 0o170000;
const S_IFLNK = 0o120000;

/** A path inside the archive as a relative "a/b/c", or undefined when it would leave the folder it is written to. */
export function safeEntryPath(name: string): string | undefined {
  if (name.includes("\0")) return undefined;
  const parts = name.replace(/\\/g, "/").split("/");
  if (parts[0] === "" || /^[a-zA-Z]:$/.test(parts[0] ?? "")) return undefined;
  const kept = parts.filter((p) => p !== "" && p !== ".");
  if (!kept.length || kept.some((p) => p === "..")) return undefined;
  return kept.join("/");
}

function endOfCentralDirectory(buf: Buffer): number {
  const lowest = Math.max(0, buf.length - 22 - 0xffff);
  for (let i = buf.length - 22; i >= lowest; i--) if (buf.readUInt32LE(i) === EOCD) return i;
  throw new Error("not a zip file");
}

/** The regular files in a zip, and the names of the entries left out. Throws on a broken or oversized archive. */
export function readZip(buf: Buffer, limits: ZipLimits): { files: ZipFile[]; skipped: string[] } {
  const files: ZipFile[] = [];
  const skipped: string[] = [];
  try {
    const end = endOfCentralDirectory(buf);
    const count = buf.readUInt16LE(end + 10);
    let at = buf.readUInt32LE(end + 16);
    if (count === 0xffff || at === 0xffffffff) throw new Error("zip64 archives are not supported");
    if (count > limits.entries) throw new Error(`the zip has more than ${limits.entries} entries`);
    let total = 0;
    for (let i = 0; i < count; i++) {
      if (buf.readUInt32LE(at) !== CENTRAL) throw new Error("not a zip file");
      const flags = buf.readUInt16LE(at + 8);
      const method = buf.readUInt16LE(at + 10);
      const packed = buf.readUInt32LE(at + 20);
      const size = buf.readUInt32LE(at + 24);
      const nameLen = buf.readUInt16LE(at + 28);
      const rest = nameLen + buf.readUInt16LE(at + 30) + buf.readUInt16LE(at + 32);
      const mode = buf.readUInt16LE(at + 4) >> 8 === UNIX ? buf.readUInt32LE(at + 38) >>> 16 : 0;
      const local = buf.readUInt32LE(at + 42);
      const raw = buf.subarray(at + 46, at + 46 + nameLen).toString(flags & 0x800 ? "utf8" : "latin1");
      at += 46 + rest;
      if (raw.endsWith("/")) continue;
      const name = safeEntryPath(raw);
      // Encrypted entries and links are left out: a link could point anywhere on the machine.
      const why = !name
        ? "points outside the folder it unpacks to"
        : flags & 1
          ? "is encrypted"
          : (mode & S_IFMT) === S_IFLNK
            ? "is a link"
            : method !== 0 && method !== 8
              ? "uses a compression APX does not read"
              : undefined;
      if (why || !name) {
        if (limits.strict) throw new Error(`${raw} ${why}`);
        skipped.push(raw);
        continue;
      }
      total += size;
      if (total > limits.bytes) throw new Error(`the zip unpacks to more than ${limits.bytes} bytes`);
      if (buf.readUInt32LE(local) !== LOCAL) throw new Error("not a zip file");
      const start = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28);
      const body = buf.subarray(start, start + packed);
      const data = method === 0 ? body : zlib.inflateRawSync(body, { maxOutputLength: Math.max(size, 1) });
      if (data.length !== size) throw new Error(`${name} is damaged in the zip`);
      files.push({ path: name, data: Buffer.from(data) });
    }
  } catch (err) {
    // Offsets past the end of a cut archive surface as RangeError.
    if (err instanceof RangeError) throw new Error("not a zip file, or a damaged one");
    throw err;
  }
  return { files, skipped };
}

/** DOS date 1980-01-01, 00:00: a packed file carries no time, so the same files always pack the same. */
const DOS_DATE = (0 << 9) | (1 << 5) | 1;

/** A zip of these files, deflated, in path order, with no times or owners: the same files give the same bytes. */
export function writeZip(files: ZipFile[]): Buffer {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  const sorted = [...files].sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  for (const f of sorted) {
    const name = Buffer.from(f.path, "utf8");
    const packed = zlib.deflateRawSync(f.data, { level: 9 });
    const crc = zlib.crc32(f.data);
    // UTF-8 names (bit 11).
    const flags = 0x800;
    const local = Buffer.alloc(30);
    local.writeUInt32LE(LOCAL, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(flags, 6);
    local.writeUInt16LE(8, 8);
    local.writeUInt16LE(DOS_DATE, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(packed.length, 18);
    local.writeUInt32LE(f.data.length, 22);
    local.writeUInt16LE(name.length, 26);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(CENTRAL, 0);
    central.writeUInt16LE((UNIX << 8) | 20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(flags, 8);
    central.writeUInt16LE(8, 10);
    central.writeUInt16LE(DOS_DATE, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(packed.length, 20);
    central.writeUInt32LE(f.data.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt32LE((0o100644 << 16) >>> 0, 38);
    central.writeUInt32LE(offset, 42);
    locals.push(local, name, packed);
    centrals.push(central, name);
    offset += 30 + name.length + packed.length;
  }
  if (sorted.length >= 0xffff || offset >= 0xffffffff) throw new Error("too big for a zip without zip64");
  const cd = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(EOCD, 0);
  end.writeUInt16LE(sorted.length, 8);
  end.writeUInt16LE(sorted.length, 10);
  end.writeUInt32LE(cd.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, cd, end]);
}
