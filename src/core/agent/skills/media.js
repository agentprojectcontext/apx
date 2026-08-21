// A skill can carry images (a golf grip, a swing position, a diagram) so an
// agent can SEND you the right one when it teaches a concept, and — on demand —
// LOOK at one itself. The model never gets the pixels for free: what rides in
// the prompt is a cheap text manifest (id → caption). The agent picks an id and
// attaches it to its message (attach_media), or pulls it into its own context
// to reason about (view_media).
//
// Where the files live:
//   • dir-style skill  (~/.apx/skills/<slug>/SKILL.md)  → alongside SKILL.md
//   • flat-style skill (<proj>/.apc/skills/<slug>.md)   → a sibling <slug>/ dir
// A `media.json` in that dir is the manifest; without one, image files in the
// dir are auto-listed (id = filename without extension, no caption).
import fs from "node:fs";
import path from "node:path";

const IMAGE_EXT = new Set([".jpg", ".jpeg", ".png", ".gif", ".webp", ".bmp", ".svg"]);

const MIME_BY_EXT = {
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".bmp": "image/bmp",
  ".svg": "image/svg+xml",
};

/** The asset directory for a resolved skill file (see file header). */
export function skillAssetsDir(skillFile) {
  if (!skillFile) return "";
  const base = path.basename(skillFile);
  if (base.toLowerCase() === "skill.md") return path.dirname(skillFile);
  // flat "<slug>.md" → sibling "<slug>/"
  return skillFile.replace(/\.md$/i, "");
}

function mimeFor(file) {
  return MIME_BY_EXT[path.extname(file).toLowerCase()] || "application/octet-stream";
}

function isImage(file) {
  return IMAGE_EXT.has(path.extname(file).toLowerCase());
}

/**
 * The media a skill declares (or that simply sit in its asset dir).
 *
 * @param {{slug:string, file:string}} skill  a loadSkill() result (needs .file)
 * @returns {Array<{id, file, path, caption, mime, exists}>}
 */
export function readSkillMedia(skill) {
  const dir = skillAssetsDir(skill?.file);
  if (!dir || !fs.existsSync(dir)) return [];

  const items = [];
  const seen = new Set();        // ids already taken
  const seenFiles = new Set();   // basenames already claimed by the manifest

  // 1) explicit manifest
  const manifestPath = path.join(dir, "media.json");
  if (fs.existsSync(manifestPath)) {
    let manifest = [];
    try { manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8")); } catch { manifest = []; }
    const list = Array.isArray(manifest) ? manifest : Array.isArray(manifest?.media) ? manifest.media : [];
    for (const raw of list) {
      if (!raw || typeof raw !== "object") continue;
      const file = String(raw.file || raw.path || "").trim();
      if (!file) continue;
      const id = String(raw.id || file.replace(/\.[^.]+$/, "")).trim();
      if (seen.has(id)) continue;
      seen.add(id);
      seenFiles.add(path.basename(file));
      const abs = path.isAbsolute(file) ? file : path.join(dir, file);
      items.push({
        id,
        file: path.basename(file),
        path: abs,
        caption: String(raw.caption || raw.when || raw.description || "").trim(),
        mime: raw.mime || mimeFor(file),
        exists: fs.existsSync(abs),
      });
    }
  }

  // 2) auto-discover any image files not already in the manifest
  let entries = [];
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { entries = []; }
  for (const e of entries) {
    if (!e.isFile()) continue;
    if (!isImage(e.name)) continue;
    if (seenFiles.has(e.name)) continue; // already described by the manifest
    const id = e.name.replace(/\.[^.]+$/, "");
    if (seen.has(id)) continue;
    seen.add(id);
    const abs = path.join(dir, e.name);
    items.push({
      id,
      file: e.name,
      path: abs,
      caption: "",
      mime: mimeFor(e.name),
      exists: true,
    });
  }

  return items;
}

/** A one-line-per-image manifest for the system prompt / read_skill result. */
export function renderMediaManifest(media) {
  const usable = (media || []).filter((m) => m.exists);
  if (!usable.length) return "";
  const lines = usable.map((m) => `- ${m.id}${m.caption ? ` — ${m.caption}` : ""}`);
  return ["Images available (attach with attach_media, inspect with view_media):", ...lines].join("\n");
}

/** Resolve one media item by id within a list. */
export function findMedia(media, id) {
  const want = String(id || "").trim();
  return (media || []).find((m) => m.id === want) || null;
}
