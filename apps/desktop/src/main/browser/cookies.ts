// Imports sessions from the user's browsers into an APX profile. Runs only in the desktop process:
// cookie values never reach the core, logs or a model. Reads copies of the databases, never the originals.
import { execFile } from "node:child_process";
import { createDecipheriv, createHash, pbkdf2Sync } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { ApxError } from "@apx/protocol/client";
import type { CookiesSetDetails, Session } from "electron";

const run = promisify(execFile);
const SUPPORT = path.join(os.homedir(), "Library", "Application Support");

export type CookieSource = {
  id: string;
  browser: string;
  profile: string;
  family: "firefox" | "chromium";
  db: string;
  keychain?: string;
};

const CHROMIUM: Array<{ browser: string; root: string; keychain: string }> = [
  { browser: "chrome", root: "Google/Chrome", keychain: "Chrome Safe Storage" },
  { browser: "brave", root: "BraveSoftware/Brave-Browser", keychain: "Brave Safe Storage" },
  { browser: "arc", root: "Arc/User Data", keychain: "Arc Safe Storage" },
  { browser: "edge", root: "Microsoft Edge", keychain: "Microsoft Edge Safe Storage" },
];
const FIREFOX: Array<{ browser: string; root: string }> = [
  { browser: "zen", root: "zen/Profiles" },
  { browser: "firefox", root: "Firefox/Profiles" },
];

export function discoverSources(): CookieSource[] {
  const out: CookieSource[] = [];
  for (const f of FIREFOX) {
    const dir = path.join(SUPPORT, f.root);
    for (const name of safeList(dir)) {
      const db = path.join(dir, name, "cookies.sqlite");
      if (fs.existsSync(db))
        out.push({
          id: `${f.browser}:${name}`,
          browser: f.browser,
          profile: name.replace(/^[^.]+\./, ""),
          family: "firefox",
          db,
        });
    }
  }
  for (const c of CHROMIUM) {
    const dir = path.join(SUPPORT, c.root);
    for (const name of safeList(dir).filter((n) => n === "Default" || /^Profile \d+$/.test(n))) {
      const db = [path.join(dir, name, "Network", "Cookies"), path.join(dir, name, "Cookies")].find((p) =>
        fs.existsSync(p),
      );
      if (db)
        out.push({
          id: `${c.browser}:${name}`,
          browser: c.browser,
          profile: name,
          family: "chromium",
          db,
          keychain: c.keychain,
        });
    }
  }
  return out;
}

function safeList(dir: string): string[] {
  try {
    return fs.readdirSync(dir);
  } catch {
    return [];
  }
}

/** Copies the db (+ WAL/SHM) to a private temp dir: browsers keep the live file locked and recent rows in the WAL. */
async function withCopy<T>(db: string, fn: (copy: string) => Promise<T>): Promise<T> {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "apx-cookies-"));
  fs.chmodSync(tmp, 0o700);
  try {
    const copy = path.join(tmp, "cookies.db");
    fs.copyFileSync(db, copy);
    for (const ext of ["-wal", "-shm"]) if (fs.existsSync(db + ext)) fs.copyFileSync(db + ext, copy + ext);
    return await fn(copy);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

async function query<T>(db: string, sql: string): Promise<T[]> {
  const { stdout } = await run("/usr/bin/sqlite3", ["-readonly", "-json", db, sql], { maxBuffer: 64 * 1024 * 1024 });
  return stdout.trim() ? (JSON.parse(stdout) as T[]) : [];
}

const sqlStr = (s: string) => `'${s.replaceAll("'", "''")}'`;
const domainFilter = (col: string, domains: string[]) =>
  domains
    .map((d) => `(${col} = ${sqlStr(d)} OR ${col} = ${sqlStr(`.${d}`)} OR ${col} LIKE ${sqlStr(`%.${d}`)})`)
    .join(" OR ");

// Second-level labels under country TLDs (acme.com.ar, acme.co.uk): keep three labels there.
const SECOND_LEVEL = new Set(["com", "net", "org", "gob", "gov", "edu", "co", "ac", "mil", "int"]);
export const registrable = (host: string) => {
  const parts = host.replace(/^\./, "").split(".");
  const tld = parts.at(-1) ?? "";
  const sld = parts.at(-2) ?? "";
  const n = tld.length === 2 && SECOND_LEVEL.has(sld) ? 3 : 2;
  return parts.slice(-n).join(".");
};

export async function listDomains(src: CookieSource, filter = ""): Promise<Array<{ domain: string; count: number }>> {
  const col = src.family === "firefox" ? "host" : "host_key";
  const table = src.family === "firefox" ? "moz_cookies" : "cookies";
  const rows = await withCopy(src.db, (db) =>
    query<{ h: string; n: number }>(db, `SELECT ${col} AS h, COUNT(*) AS n FROM ${table} GROUP BY ${col}`),
  );
  const byDomain = new Map<string, number>();
  for (const r of rows) {
    const d = registrable(r.h);
    if (!filter || d.includes(filter.toLowerCase())) byDomain.set(d, (byDomain.get(d) ?? 0) + Number(r.n));
  }
  return [...byDomain].map(([domain, count]) => ({ domain, count })).sort((a, b) => b.count - a.count);
}

type Imported = { imported: number; skipped: number; failed: number };

export async function importCookies(src: CookieSource, domains: string[], ses: Session): Promise<Imported> {
  const clean = domains
    .map((d) => d.toLowerCase().replace(/^\.+/, ""))
    .filter((d) => /^[a-z0-9.-]+\.[a-z]{2,}$/.test(d));
  if (!clean.length) throw new ApxError({ code: "bad_request", message: "no valid domains" });
  const details = src.family === "firefox" ? await readFirefox(src, clean) : await readChromium(src, clean);
  const nowS = Date.now() / 1000;
  const fresh = details.filter((d) => d.expirationDate === undefined || d.expirationDate > nowS);
  const results = await Promise.allSettled(fresh.map((d) => ses.cookies.set(d)));
  await ses.cookies.flushStore();
  return {
    imported: results.filter((r) => r.status === "fulfilled").length,
    failed: results.filter((r) => r.status === "rejected").length,
    skipped: details.length - fresh.length,
  };
}

export function toDetails(
  host: string,
  name: string,
  value: string,
  p: string,
  secure: boolean,
  httpOnly: boolean,
  sameSite: CookiesSetDetails["sameSite"],
  expires?: number,
): CookiesSetDetails {
  const bare = host.replace(/^\./, "");
  // A leading dot means a domain cookie; without it the cookie is host-only and must not get `domain`.
  const hostOnly = !host.startsWith(".") || name.startsWith("__Host-");
  const ss = sameSite === "no_restriction" && !secure ? "unspecified" : sameSite;
  return {
    url: `${secure ? "https" : "http"}://${bare}${p || "/"}`,
    name,
    value,
    path: name.startsWith("__Host-") ? "/" : p || "/",
    secure,
    httpOnly,
    sameSite: ss,
    ...(hostOnly ? {} : { domain: host }),
    ...(expires ? { expirationDate: expires } : {}),
  };
}

async function readFirefox(src: CookieSource, domains: string[]): Promise<CookiesSetDetails[]> {
  type Row = {
    host: string;
    name: string;
    value: string;
    path: string;
    expiry: number;
    isSecure: number;
    isHttpOnly: number;
    sameSite: number;
    rawSameSite: number;
  };
  const rows = await withCopy(src.db, async (db) => {
    // Schemas differ between Firefox forks and versions: select only what exists.
    const cols = new Set((await query<{ name: string }>(db, "PRAGMA table_info(moz_cookies)")).map((c) => c.name));
    const raw = cols.has("rawSameSite") ? "rawSameSite" : "1 AS rawSameSite";
    // Containers and partitioned cookies carry originAttributes; only the default jar is imported.
    const scope = cols.has("originAttributes") ? "originAttributes = '' AND" : "";
    return query<Row>(
      db,
      `SELECT host, name, value, path, expiry, isSecure, isHttpOnly, sameSite, ${raw} FROM moz_cookies WHERE ${scope} (${domainFilter("host", domains)})`,
    );
  });
  return rows.map((r) => {
    const expiry = Number(r.expiry) > 1e11 ? Number(r.expiry) / 1000 : Number(r.expiry);
    const sameSite =
      r.sameSite === 1 ? "lax" : r.sameSite === 2 ? "strict" : r.rawSameSite === 0 ? "unspecified" : "no_restriction";
    return toDetails(
      r.host,
      r.name,
      r.value,
      r.path,
      Boolean(r.isSecure),
      Boolean(r.isHttpOnly),
      sameSite,
      expiry || undefined,
    );
  });
}

async function readChromium(src: CookieSource, domains: string[]): Promise<CookiesSetDetails[]> {
  if (!src.keychain) throw new ApxError({ code: "bad_request", message: "no keychain entry for this browser" });
  // macOS shows its own Keychain dialog here: that dialog is the user's consent.
  const { stdout } = await run("/usr/bin/security", ["find-generic-password", "-w", "-s", src.keychain]).catch(() => {
    throw new ApxError({
      code: "unavailable",
      message: `Keychain access to "${src.keychain}" was denied or not found`,
    });
  });
  const key = pbkdf2Sync(stdout.trim(), "saltysalt", 1003, 16, "sha1");
  type Row = {
    host_key: string;
    name: string;
    enc: string;
    path: string;
    expires_utc: number;
    is_secure: number;
    is_httponly: number;
    samesite: number;
    has_expires: number;
  };
  const { rows, version } = await withCopy(src.db, async (db) => {
    const meta = await query<{ value: string }>(db, "SELECT value FROM meta WHERE key = 'version'").catch(() => []);
    const r = await query<Row>(
      db,
      `SELECT host_key, name, hex(encrypted_value) AS enc, path, expires_utc, is_secure, is_httponly, samesite, has_expires FROM cookies WHERE (${domainFilter("host_key", domains)})`,
    );
    return { rows: r, version: Number(meta[0]?.value ?? 0) };
  });
  const out: CookiesSetDetails[] = [];
  for (const r of rows) {
    const value = decryptChromium(Buffer.from(r.enc, "hex"), key, r.host_key, version);
    if (value === undefined) continue;
    const expires = Number(r.has_expires) ? Number(r.expires_utc) / 1e6 - 11_644_473_600 : undefined;
    const sameSite =
      r.samesite === 0 ? "no_restriction" : r.samesite === 1 ? "lax" : r.samesite === 2 ? "strict" : "unspecified";
    out.push(
      toDetails(r.host_key, r.name, value, r.path, Boolean(r.is_secure), Boolean(r.is_httponly), sameSite, expires),
    );
  }
  return out;
}

export function decryptChromium(enc: Buffer, key: Buffer, host: string, version: number): string | undefined {
  if (enc.subarray(0, 3).toString() !== "v10") return undefined;
  try {
    const decipher = createDecipheriv("aes-128-cbc", key, Buffer.alloc(16, 0x20));
    let plain = Buffer.concat([decipher.update(enc.subarray(3)), decipher.final()]);
    // Since db version 24 the plaintext starts with SHA-256(host_key).
    if (version >= 24 && plain.subarray(0, 32).equals(createHash("sha256").update(host).digest()))
      plain = plain.subarray(32);
    return plain.toString("utf8");
  } catch {
    return undefined;
  }
}
