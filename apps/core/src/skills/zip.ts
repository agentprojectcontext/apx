// Reads a .zip in memory: stored and deflated entries of regular files. Folders are implied by paths; links, unsafe
// paths, encrypted entries and zip64 archives are not read. Nothing is written or run here.
import zlib from "node:zlib";

export type ZipFile = { path: string; data: Buffer };
export type ZipLimits = { entries: number; bytes: number };

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
      if (!name || flags & 1 || (mode & S_IFMT) === S_IFLNK || (method !== 0 && method !== 8)) {
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
