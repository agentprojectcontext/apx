// Helpers shared by every image adapter. Nothing here talks to a specific
// server — it is the plumbing three of the four adapters would otherwise each
// grow their own copy of (base64 → file, size parsing, endpoint joining).

import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";

/** Strip a trailing slash so `${base}/v1/x` never becomes `//v1/x`. */
export function trimBase(url) {
  return String(url || "").replace(/\/+$/, "");
}

/**
 * Join a base URL and a path, tolerating a base that already carries the API
 * prefix. A user who pastes `http://host:8189/v1` into the OpenAI field and one
 * who pastes `http://host:8189` must both end up at /v1/images/generations —
 * getting this wrong is the single most common way a local endpoint "doesn't
 * work" (it 404s and the error says nothing about the URL).
 */
export function joinUrl(base, suffix) {
  const b = trimBase(base);
  const s = suffix.startsWith("/") ? suffix : `/${suffix}`;
  // e.g. base ".../v1" + suffix "/v1/images/generations" → don't repeat /v1
  const firstSeg = s.split("/")[1];
  if (firstSeg && b.endsWith(`/${firstSeg}`)) {
    return b + s.slice(firstSeg.length + 1);
  }
  return b + s;
}

/** "512x768" → { width: 512, height: 768 }. Returns null when unparseable. */
export function parseSize(size) {
  const m = /^\s*(\d{2,5})\s*[x×*]\s*(\d{2,5})\s*$/.exec(String(size || ""));
  if (!m) return null;
  return { width: Number(m[1]), height: Number(m[2]) };
}

/** Reverse of parseSize — what OpenAI-shaped APIs want. */
export function formatSize(width, height) {
  return `${width}x${height}`;
}

const MIME_BY_EXT = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  webp: "image/webp",
  gif: "image/gif",
};

export function mimeFor(format) {
  return MIME_BY_EXT[String(format || "png").toLowerCase()] || "application/octet-stream";
}

/**
 * Sniff the real container from the first bytes. Servers lie about (or omit)
 * the format: stable-diffusion.cpp answers `output_format: "png"` for a
 * request that asked for webp. The file extension should describe the actual
 * bytes, or every viewer downstream has to guess.
 */
export function sniffFormat(buf, fallback = "png") {
  if (!buf || buf.length < 12) return fallback;
  if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) return "png";
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return "jpeg";
  if (buf.toString("ascii", 0, 4) === "RIFF" && buf.toString("ascii", 8, 12) === "WEBP") return "webp";
  if (buf.toString("ascii", 0, 3) === "GIF") return "gif";
  return fallback;
}

/**
 * Write one decoded image into `outDir` and describe it. `index` only shapes
 * the filename, so a batch stays ordered on disk the way it was generated.
 */
export function writeImage(buf, { outDir, provider, format, index = 0 }) {
  const ext = sniffFormat(buf, format);
  fs.mkdirSync(outDir, { recursive: true });
  const suffix = index > 0 ? `-${index + 1}` : "";
  const file = path.join(outDir, `${provider}-${randomUUID()}${suffix}.${ext === "jpeg" ? "jpg" : ext}`);
  fs.writeFileSync(file, buf);
  return { path: file, bytes: buf.length, mime: mimeFor(ext), format: ext };
}

/** Decode a base64 payload, tolerating a `data:image/png;base64,…` prefix. */
export function decodeBase64Image(b64) {
  const raw = String(b64 || "").replace(/^data:[^;]+;base64,/, "");
  if (!raw) throw new Error("empty image payload");
  return Buffer.from(raw, "base64");
}

/**
 * POST JSON and parse the reply, turning a non-2xx into an Error whose message
 * carries the server's own words — a 400 from a diffusion server usually names
 * the offending field, and swallowing that costs the user the fix.
 */
export async function postJson(url, body, { headers = {}, signal, timeoutMs } = {}) {
  const ctrl = timeoutMs ? new AbortController() : null;
  const timer = ctrl ? setTimeout(() => ctrl.abort(), timeoutMs) : null;
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json", ...headers },
      body: JSON.stringify(body),
      signal: signal || ctrl?.signal,
    });
    const text = await res.text();
    let json = null;
    try { json = text ? JSON.parse(text) : null; } catch { /* keep text */ }
    if (!res.ok) {
      const detail = json?.error?.message || json?.error || json?.detail || text;
      throw new Error(`${res.status}: ${String(detail).slice(0, 300)}`);
    }
    return json;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/** GET JSON with the same error shaping as postJson. */
export async function getJson(url, { headers = {}, signal, timeoutMs } = {}) {
  const ctrl = timeoutMs ? new AbortController() : null;
  const timer = ctrl ? setTimeout(() => ctrl.abort(), timeoutMs) : null;
  try {
    const res = await fetch(url, { headers, signal: signal || ctrl?.signal });
    const text = await res.text();
    let json = null;
    try { json = text ? JSON.parse(text) : null; } catch { /* keep text */ }
    if (!res.ok) {
      const detail = json?.error?.message || json?.error || json?.detail || text;
      throw new Error(`${res.status}: ${String(detail).slice(0, 300)}`);
    }
    return json;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/**
 * Is this endpoint answering at all? Used by isAvailable() probes: a
 * configured-but-unreachable local server must not win the routing chain, or
 * every generation fails with a connection error instead of falling through to
 * the next engine.
 */
export async function probeUrl(url, { headers = {}, timeoutMs = 1500 } = {}) {
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const res = await fetch(url, { headers, signal: ctrl.signal });
      return res.ok;
    } finally {
      clearTimeout(timer);
    }
  } catch {
    return false;
  }
}
