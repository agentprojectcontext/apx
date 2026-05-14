/**
 * Stub for opencode filesystem utility.
 */
import fs from "node:fs"
import path from "node:path"

export async function readText(filepath) {
  return fs.promises.readFile(filepath, "utf8")
}

export async function readBytes(filepath) {
  return fs.promises.readFile(filepath)
}

export async function readArrayBuffer(filepath) {
  const buf = await fs.promises.readFile(filepath)
  return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength)
}

export async function mimeType(filepath) {
  const ext = path.extname(filepath).toLowerCase()
  const map = {
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".gif": "image/gif",
    ".webp": "image/webp",
    ".svg": "image/svg+xml",
    ".pdf": "application/pdf",
  }
  return map[ext] ?? "application/octet-stream"
}

export function relative(from, to) {
  return to
}

export function contains(parent, child) {
  const rel = path.relative(parent, child)
  return !rel.startsWith("..") && !path.isAbsolute(rel)
}
