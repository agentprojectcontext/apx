// The current one-time code of a stored TOTP seed (RFC 6238): a base32 seed, or an `otpauth://totp/…` address as
// sites show it in their QR code. Computed inside the handler that fills it; the seed never leaves the core.
import { createHmac } from "node:crypto";

const BASE32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
const ALGORITHMS = { SHA1: "sha1", SHA256: "sha256", SHA512: "sha512" } as const;

function base32(seed: string): Buffer {
  const clean = seed.toUpperCase().replace(/[\s-]/g, "").replace(/=+$/, "");
  if (!clean || /[^A-Z2-7]/.test(clean)) throw new Error("not a one-time code seed");
  let bits = 0;
  let acc = 0;
  const out: number[] = [];
  for (const ch of clean) {
    acc = (acc << 5) | BASE32.indexOf(ch);
    bits += 5;
    if (bits >= 8) {
      bits -= 8;
      out.push((acc >>> bits) & 0xff);
    }
  }
  return Buffer.from(out);
}

type Seed = { key: Buffer; digits: number; period: number; algorithm: (typeof ALGORITHMS)[keyof typeof ALGORITHMS] };

function parseSeed(stored: string): Seed {
  if (!stored.startsWith("otpauth://")) return { key: base32(stored), digits: 6, period: 30, algorithm: "sha1" };
  const u = new URL(stored);
  if (u.host !== "totp") throw new Error("only time-based one-time codes are supported");
  const digits = Number(u.searchParams.get("digits") ?? 6);
  const period = Number(u.searchParams.get("period") ?? 30);
  const algorithm = ALGORITHMS[(u.searchParams.get("algorithm") ?? "SHA1").toUpperCase() as keyof typeof ALGORITHMS];
  if (!algorithm || ![6, 7, 8].includes(digits) || !(period >= 1 && period <= 300))
    throw new Error("not a one-time code seed");
  return { key: base32(u.searchParams.get("secret") ?? ""), digits, period, algorithm };
}

/** The code valid at `now` (ms since the epoch). */
export function totp(stored: string, now: number): string {
  const { key, digits, period, algorithm } = parseSeed(stored);
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(now / 1000 / period)));
  const mac = createHmac(algorithm, key).update(counter).digest();
  const at = (mac[mac.length - 1] as number) & 0xf;
  const n = mac.readUInt32BE(at) & 0x7fffffff;
  return String(n % 10 ** digits).padStart(digits, "0");
}
