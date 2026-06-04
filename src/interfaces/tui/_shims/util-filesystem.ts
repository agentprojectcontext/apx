import fs from "node:fs"
import path from "node:path"

export const Filesystem = {
  relative: (_from: string, to: string) => to,
  contains: (parent: string, child: string): boolean => {
    const rel = path.relative(parent, child)
    return !rel.startsWith("..") && !path.isAbsolute(rel)
  },
  mimeType: async (filepath: string): Promise<string> => {
    const ext = path.extname(filepath).toLowerCase()
    const map: Record<string, string> = {
      ".png": "image/png",
      ".jpg": "image/jpeg",
      ".jpeg": "image/jpeg",
      ".gif": "image/gif",
      ".webp": "image/webp",
      ".svg": "image/svg+xml",
      ".pdf": "application/pdf",
    }
    return map[ext] ?? "application/octet-stream"
  },
  readText: async (filepath: string): Promise<string> => {
    return fs.promises.readFile(filepath, "utf8")
  },
  readArrayBuffer: async (filepath: string): Promise<ArrayBuffer> => {
    const buf = await fs.promises.readFile(filepath)
    return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer
  },
  readBytes: async (filepath: string): Promise<Buffer> => {
    return fs.promises.readFile(filepath)
  },
  readJson: async <T = unknown>(filepath: string): Promise<T> => {
    const text = await fs.promises.readFile(filepath, "utf8")
    return JSON.parse(text) as T
  },
  writeJson: async (filepath: string, data: unknown): Promise<void> => {
    await fs.promises.mkdir(path.dirname(filepath), { recursive: true })
    await fs.promises.writeFile(filepath, JSON.stringify(data, null, 2), "utf8")
  },
  write: async (filepath: string, content: string): Promise<void> => {
    await fs.promises.mkdir(path.dirname(filepath), { recursive: true })
    await fs.promises.writeFile(filepath, content, "utf8")
  },
  writeArrayBuffer: async (filepath: string, data: ArrayBuffer): Promise<void> => {
    await fs.promises.mkdir(path.dirname(filepath), { recursive: true })
    await fs.promises.writeFile(filepath, Buffer.from(data))
  },
  exists: async (filepath: string): Promise<boolean> => {
    try {
      await fs.promises.access(filepath)
      return true
    } catch {
      return false
    }
  },
  findUp: async (
    names: string[],
    cwd: string,
    _root?: string,
    _opts?: { rootFirst?: boolean },
  ): Promise<string[]> => {
    const results: string[] = []
    let current = cwd
    while (true) {
      for (const name of names) {
        const candidate = path.join(current, name)
        try {
          await fs.promises.access(candidate)
          results.push(candidate)
        } catch {}
      }
      const parent = path.dirname(current)
      if (parent === current) break
      current = parent
    }
    return results
  },
}
