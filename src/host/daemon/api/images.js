// Daemon HTTP routes for image generation.
//
//   POST /images/generate    { prompt, provider?, width?, height?, size?,
//                              steps?, cfg_scale?, seed?, sampler?, scheduler?,
//                              count?, format?, negative_prompt?, model? }
//                            → { images: [{path, url, bytes, mime, seed}],
//                                provider, model, request, ignored, elapsed_ms }
//
//   GET  /images/providers   → { configured_provider, mode, order, defaults,
//                                engines: [{id, available, configured, …}] }
//
//   GET  /images/capabilities?provider=<id>
//                            → { provider, capabilities: {models, samplers, …} }
//
//   GET  /images/file?path=<abs>
//                            → the bytes, sandboxed to ~/.apx/images
//
// Glue only: every decision (engine routing, defaults, where files land) lives
// in core/images/. `url` is added here because it is a transport concern —
// core has no idea an HTTP client will need a way to fetch the file back.
import fs from "node:fs/promises";
import path from "node:path";
import { IMAGES_DIR } from "#core/config/paths.js";
import { readConfig } from "#core/config/index.js";
import { generate, listProviders, capabilities } from "#core/images/generate.js";
import { apiPath } from "./prefix.js";
import { asyncRoute } from "./shared.js";

/** Where a client can fetch this file from. Absolute paths stay server-side. */
function fileUrl(absPath) {
  return `${apiPath("/images/file")}?path=${encodeURIComponent(absPath)}`;
}

export function register(api) {
  api.post("/images/generate", asyncRoute(async (req, res) => {
    const body = req.body || {};
    if (typeof body.prompt !== "string" || !body.prompt.trim()) {
      return res.status(400).json({ error: "prompt required" });
    }
    try {
      const result = await generate({ ...body, globalConfig: readConfig() });
      res.json({
        ...result,
        images: result.images.map((img) => ({ ...img, url: fileUrl(img.path) })),
      });
    } catch (e) {
      res.status(502).json({ error: e.message });
    }
  }));

  api.get("/images/providers", asyncRoute(async (_req, res) => {
    try {
      res.json(await listProviders(readConfig()));
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  }));

  api.get("/images/capabilities", asyncRoute(async (req, res) => {
    try {
      res.json(await capabilities({
        provider: req.query.provider ? String(req.query.provider) : undefined,
        globalConfig: readConfig(),
      }));
    } catch (e) {
      res.status(400).json({ error: e.message });
    }
  }));

  // Sandboxed to the gallery: a path that escapes it is refused, so a leaked
  // absolute path in a reply can never be turned into an arbitrary file read.
  api.get("/images/file", asyncRoute(async (req, res) => {
    const rawPath = String(req.query.path || "");
    if (!rawPath) return res.status(400).json({ error: "path required" });
    const root = path.resolve(IMAGES_DIR);
    const resolved = path.resolve(rawPath);
    if (resolved !== root && !resolved.startsWith(root + path.sep)) {
      return res.status(403).json({ error: "path outside images dir" });
    }
    let bytes;
    try {
      bytes = await fs.readFile(resolved);
    } catch {
      return res.status(404).json({ error: "not found" });
    }
    const ext = path.extname(resolved).toLowerCase();
    const mime =
      ext === ".png" ? "image/png" :
      ext === ".jpg" || ext === ".jpeg" ? "image/jpeg" :
      ext === ".webp" ? "image/webp" :
      ext === ".gif" ? "image/gif" :
      "application/octet-stream";
    res.setHeader("Content-Type", mime);
    // Immutable content at a unique path — cache hard so a gallery of
    // thumbnails doesn't re-read disk on every render.
    res.setHeader("Cache-Control", "private, max-age=86400");
    res.send(bytes);
  }));
}
