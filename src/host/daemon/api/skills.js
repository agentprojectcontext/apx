// `/skills` listing + enable/disable + Skill Inspector control surface.
//
//   GET    /skills                     catalog annotated with enabled/private per scope
//   GET    /skills/:slug/detail        full body + frontmatter for the viewer
//   PUT    /skills/enabled             toggle a skill on/off (or clear) for a scope
//   POST   /skills                     create a user skill (online editor)
//   POST   /skills/import/zip          import a skill from an uploaded .zip
//   POST   /skills/import/repo         import a skill by cloning a git repo
//   DELETE /skills/:slug               delete a user skill
//   GET    /skills/inspector           inspector config + index status
//   PUT    /skills/inspector           toggle / tune inspector config
//   POST   /skills/index               (re)build the inspector vector index
//   POST   /skills/inspect             dry-run the inspector for a prompt
//
// A "scope" is either "default" (the super-agent / no-project baseline) or a
// project's absolute path. Creating/importing with a project_path targets that
// project's <project>/.apc/skills/ (source "project"); without it, skills land
// in ~/.apx/skills/ (source "global"). Built-in skills are private: always
// active, never disableable or deletable. The inspector routes mirror
// /embeddings/* so the web admin configures the skill RAG like the memory RAG.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { listSkills, loadSkill, SKILL_LOCATIONS } from "#core/agent/skills/loader.js";
import { condenseSkillDescription } from "#core/agent/skills/catalog.js";
import { apcSkillsDir } from "#core/apc/paths.js";
import {
  annotateSkills,
  setSkillEnabled,
  resolveScopeKey,
  isPrivateSkill,
} from "#core/agent/skills/policy.js";
import {
  inspectPromptForSkills,
  INSPECTOR_DEFAULTS,
} from "#core/agent/skills/inspector.js";
import {
  ensureIndex,
  planIndex,
  readIndex,
} from "#core/agent/skills/index-store.js";
import { readConfig, writeConfig } from "#core/config/index.js";

const SLUG_RE = /^[a-z0-9][a-z0-9-]*$/;
// Only http(s)/ssh/git git remotes — never a local path or shell metachar.
const REPO_URL_RE = /^(https?:\/\/|git@|ssh:\/\/|git:\/\/)[\w.@:/\-~]+$/;

const KNOWN_KEYS = Object.keys(INSPECTOR_DEFAULTS);

// Where a newly created/imported skill lands, given a scope. A project_path
// targets that project's .apc/skills/ (source "project"); otherwise the global
// ~/.apx/skills/ (source "global").
function targetSkillsDir(projectPath) {
  return projectPath ? apcSkillsDir(projectPath) : SKILL_LOCATIONS.global;
}

function skillExists(slug, projectPath) {
  return listSkills({ projectPath }).some((s) => s.slug === slug);
}

function writeSkillFile(dir, slug, description, body) {
  fs.mkdirSync(dir, { recursive: true });
  const fmDesc = String(description || "").replace(/\r?\n/g, " ").trim();
  const content =
    `---\nname: ${slug}\ndescription: ${fmDesc}\n---\n\n${String(body || "").trim()}\n`;
  fs.writeFileSync(path.join(dir, "SKILL.md"), content, "utf8");
}

// Find the skill root inside an extracted/cloned tree: the dir that directly
// contains a SKILL.md (the tree itself, or its single top-level subdir).
function findSkillRoot(root) {
  if (fs.existsSync(path.join(root, "SKILL.md"))) return root;
  let entries;
  try { entries = fs.readdirSync(root, { withFileTypes: true }); } catch { return null; }
  const dirs = entries.filter((e) => e.isDirectory() && e.name !== "__MACOSX");
  for (const d of dirs) {
    const sub = path.join(root, d.name);
    if (fs.existsSync(path.join(sub, "SKILL.md"))) return sub;
  }
  return null;
}

function readSlugFromSkill(dir, fallback) {
  try {
    const raw = fs.readFileSync(path.join(dir, "SKILL.md"), "utf8");
    const m = raw.match(/^---[\s\S]*?\bname\s*:\s*(.+?)\s*$/m);
    if (m && SLUG_RE.test(m[1].trim())) return m[1].trim();
  } catch { /* ignore */ }
  return fallback;
}

// Copy an extracted skill dir into the target skills location under <slug>/.
function installSkillDir(srcDir, slug, projectPath) {
  const destBase = targetSkillsDir(projectPath);
  const dest = path.join(destBase, slug);
  fs.mkdirSync(destBase, { recursive: true });
  fs.cpSync(srcDir, dest, { recursive: true });
  return dest;
}

function mergedInspectorConfig(cfg) {
  return { ...INSPECTOR_DEFAULTS, ...(cfg?.skills?.inspector || {}) };
}

function indexStatus() {
  const idx = readIndex();
  return {
    count: Object.keys(idx.items || {}).length,
    embedder: idx.embedder || null,
    dim: idx.dim || null,
    updated_at: idx.updated_at || null,
  };
}

export function register(app /*, ctx */) {
  app.get("/skills", (req, res) => {
    const projectPath = typeof req.query?.project_path === "string" && req.query.project_path
      ? req.query.project_path
      : undefined;
    // A caller may ask about the "default" (super-agent) scope while still
    // wanting project-scoped skills scanned — keep the two concerns separate.
    const scope = typeof req.query?.scope === "string" && req.query.scope
      ? req.query.scope
      : undefined;
    try {
      const cfg = readConfig();
      const scopeKey = resolveScopeKey(scope || projectPath);
      const annotated = annotateSkills(listSkills({ projectPath }), {
        config: cfg,
        projectPath: scopeKey === "default" ? undefined : scopeKey,
      });
      res.json({
        count: annotated.length,
        scope: scopeKey,
        skills: annotated.map((s) => ({
          slug: s.slug,
          source: s.source,
          description: condenseSkillDescription(s.description),
          enabled: s.enabled,
          private: s.private,
          overridden: s.overridden,
        })),
      });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  // ---- Full detail (viewer) ----------------------------------------------

  app.get("/skills/:slug/detail", (req, res) => {
    try {
      const projectPath = typeof req.query?.project_path === "string" && req.query.project_path
        ? req.query.project_path
        : undefined;
      const skill = loadSkill(req.params.slug, { projectPath });
      const cfg = readConfig();
      const [annotated] = annotateSkills([skill], { config: cfg, projectPath });
      res.json({
        slug: skill.slug,
        source: skill.source,
        description: skill.description,
        frontmatter: skill.frontmatter,
        body: skill.body,
        file: skill.file,
        enabled: annotated?.enabled ?? true,
        private: annotated?.private ?? false,
        overridden: annotated?.overridden ?? false,
      });
    } catch (e) {
      res.status(404).json({ error: e.message });
    }
  });

  // ---- Enable / disable per scope ----------------------------------------

  app.put("/skills/enabled", (req, res) => {
    try {
      const { slug, enabled, scope, project_path } = req.body || {};
      if (!slug || typeof slug !== "string") {
        return res.status(400).json({ error: "slug required" });
      }
      const cfg = readConfig();
      const all = listSkills({ projectPath: project_path });
      const target = all.find((s) => s.slug === slug);
      if (!target) return res.status(404).json({ error: `skill "${slug}" not found` });
      if (isPrivateSkill(target)) {
        return res.status(403).json({ error: `skill "${slug}" is private (built-in) and always active` });
      }
      // enabled: boolean sets an override; null/undefined clears it (inherit).
      const value = enabled === null || enabled === undefined ? null : !!enabled;
      setSkillEnabled(cfg, { slug, enabled: value, scope, projectPath: project_path });
      writeConfig(cfg);
      const scopeKey = resolveScopeKey(scope || project_path);
      res.json({ ok: true, slug, scope: scopeKey, enabled: value });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  // ---- Create / import user skills ---------------------------------------

  // Online editor: write a SKILL.md from slug + description + body.
  app.post("/skills", (req, res) => {
    try {
      const { slug, description, body, project_path } = req.body || {};
      if (!slug || typeof slug !== "string" || !SLUG_RE.test(slug)) {
        return res.status(400).json({ error: "slug required (lowercase letters, digits, dashes)" });
      }
      if (skillExists(slug, project_path)) {
        return res.status(409).json({ error: `a skill named "${slug}" already exists in this scope` });
      }
      const dir = path.join(targetSkillsDir(project_path), slug);
      writeSkillFile(dir, slug, description, body);
      res.status(201).json({ ok: true, slug, source: project_path ? "project" : "global" });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  // Import from an uploaded .zip (sent as base64 in JSON — skills are tiny).
  app.post("/skills/import/zip", (req, res) => {
    let tmp;
    try {
      const { data, project_path } = req.body || {};
      if (!data || typeof data !== "string") {
        return res.status(400).json({ error: "zip data (base64) required" });
      }
      const buf = Buffer.from(data.replace(/^data:.*;base64,/, ""), "base64");
      if (!buf.length) return res.status(400).json({ error: "empty zip" });

      tmp = fs.mkdtempSync(path.join(os.tmpdir(), "apx-skill-zip-"));
      const zipPath = path.join(tmp, "skill.zip");
      fs.writeFileSync(zipPath, buf);
      const out = path.join(tmp, "out");
      fs.mkdirSync(out);
      const unzip = spawnSync("unzip", ["-qq", "-o", zipPath, "-d", out], { encoding: "utf8" });
      if (unzip.status !== 0) {
        return res.status(400).json({ error: `unzip failed: ${(unzip.stderr || "bad archive").trim()}` });
      }
      const root = findSkillRoot(out);
      if (!root) return res.status(400).json({ error: "no SKILL.md found in the zip" });
      const slug = readSlugFromSkill(root, path.basename(root));
      if (!SLUG_RE.test(slug)) return res.status(400).json({ error: `invalid skill name "${slug}"` });
      if (skillExists(slug, project_path)) {
        return res.status(409).json({ error: `a skill named "${slug}" already exists in this scope` });
      }
      installSkillDir(root, slug, project_path);
      res.status(201).json({ ok: true, slug, source: project_path ? "project" : "global" });
    } catch (e) {
      res.status(500).json({ error: e.message });
    } finally {
      if (tmp) fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  // Import by cloning a git repo. The repo root (or its single skill subdir)
  // must contain a SKILL.md.
  app.post("/skills/import/repo", (req, res) => {
    let tmp;
    try {
      const { url, project_path } = req.body || {};
      if (!url || typeof url !== "string" || !REPO_URL_RE.test(url.trim())) {
        return res.status(400).json({ error: "a valid git URL (https/ssh/git) is required" });
      }
      tmp = fs.mkdtempSync(path.join(os.tmpdir(), "apx-skill-repo-"));
      const clone = path.join(tmp, "repo");
      // Array args (no shell) — url is regex-validated above.
      const git = spawnSync("git", ["clone", "--depth", "1", url.trim(), clone], {
        encoding: "utf8",
        timeout: 60_000,
        env: { ...process.env, GIT_TERMINAL_PROMPT: "0" },
      });
      if (git.status !== 0) {
        return res.status(400).json({ error: `git clone failed: ${(git.stderr || "").trim().slice(0, 300)}` });
      }
      const root = findSkillRoot(clone);
      if (!root) return res.status(400).json({ error: "no SKILL.md found in the repo" });
      const slug = readSlugFromSkill(root, path.basename(root));
      if (!SLUG_RE.test(slug)) return res.status(400).json({ error: `invalid skill name "${slug}"` });
      if (skillExists(slug, project_path)) {
        return res.status(409).json({ error: `a skill named "${slug}" already exists in this scope` });
      }
      // Strip the repo's .git before installing so we don't nest a git dir.
      fs.rmSync(path.join(root, ".git"), { recursive: true, force: true });
      installSkillDir(root, slug, project_path);
      res.status(201).json({ ok: true, slug, source: project_path ? "project" : "global" });
    } catch (e) {
      res.status(500).json({ error: e.message });
    } finally {
      if (tmp) fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  app.delete("/skills/:slug", (req, res) => {
    try {
      const slug = req.params.slug;
      if (!slug || !SLUG_RE.test(slug)) {
        return res.status(400).json({ error: "invalid slug" });
      }
      const projectPath = typeof req.query?.project_path === "string" && req.query.project_path
        ? req.query.project_path
        : undefined;
      let entry;
      try { entry = loadSkill(slug, { projectPath }); } catch { entry = null; }
      if (!entry) return res.status(404).json({ error: `skill "${slug}" not found` });
      // Only user-managed skills (global ~/.apx/skills or project .apc/skills)
      // can be deleted; built-in ones ship with apx.
      if (entry.source !== "global" && entry.source !== "project") {
        return res.status(403).json({ error: `built-in skill "${slug}" cannot be deleted (it ships with apx)` });
      }
      // The skill dir is the parent of its SKILL.md (dir-style) — never the
      // shared skills root itself.
      const dir = path.dirname(entry.file);
      const roots = [SKILL_LOCATIONS.global, projectPath ? apcSkillsDir(projectPath) : null]
        .filter(Boolean)
        .map((p) => path.resolve(p));
      if (roots.includes(path.resolve(dir))) {
        // Flat-style <slug>.md — remove just the file.
        fs.rmSync(entry.file, { force: true });
      } else {
        fs.rmSync(dir, { recursive: true, force: true });
      }
      // Drop any dangling enable/disable overrides for this slug.
      const cfg = readConfig();
      const pol = cfg?.skills?.policy;
      if (pol && typeof pol === "object") {
        let touched = false;
        for (const scopeKey of Object.keys(pol)) {
          if (pol[scopeKey] && slug in pol[scopeKey]) {
            delete pol[scopeKey][slug];
            if (Object.keys(pol[scopeKey]).length === 0) delete pol[scopeKey];
            touched = true;
          }
        }
        if (touched) writeConfig(cfg);
      }
      res.json({ ok: true, slug });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  // ---- Inspector config + status -----------------------------------------

  app.get("/skills/inspector", (_req, res) => {
    try {
      const cfg = readConfig();
      res.json({
        config: mergedInspectorConfig(cfg),
        defaults: INSPECTOR_DEFAULTS,
        keys: KNOWN_KEYS,
        index: indexStatus(),
      });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  app.put("/skills/inspector", (req, res) => {
    try {
      const patch = req.body || {};
      const cfg = readConfig();
      cfg.skills = cfg.skills || {};
      const current = mergedInspectorConfig(cfg);
      const next = { ...current };

      for (const [k, v] of Object.entries(patch)) {
        if (!KNOWN_KEYS.includes(k)) continue;
        const def = INSPECTOR_DEFAULTS[k];
        if (typeof def === "boolean") next[k] = !!v;
        else if (typeof def === "number") {
          const n = Number(v);
          if (Number.isFinite(n)) next[k] = n;
        } else {
          next[k] = v;
        }
      }

      cfg.skills.inspector = next;
      writeConfig(cfg);
      res.json({ ok: true, config: next, index: indexStatus() });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  // ---- Index build --------------------------------------------------------

  app.post("/skills/index", async (req, res) => {
    try {
      const { project_path, force } = req.body || {};
      const cfg = readConfig();
      const plan = planIndex({ projectPath: project_path });
      const out = await ensureIndex({
        projectPath: project_path,
        embedOpts: { globalConfig: cfg },
        force: !!force,
      });
      res.json({
        ok: true,
        embedder: out.embedder,
        dim: out.dim,
        planned: {
          missing: plan.missing.length,
          stale: plan.stale.length,
          gone: plan.gone.length,
          total: plan.total,
        },
        changed: {
          added: out.changed.added.length,
          refreshed: out.changed.refreshed.length,
          removed: out.changed.removed.length,
          kept: out.changed.kept.length,
        },
        index: indexStatus(),
      });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  // ---- Dry-run ------------------------------------------------------------

  app.post("/skills/inspect", async (req, res) => {
    try {
      const { prompt, project_path } = req.body || {};
      if (!prompt || typeof prompt !== "string") {
        return res.status(400).json({ error: "prompt required" });
      }
      const cfg = readConfig();
      // Force enabled for the dry-run so the operator sees what it WOULD do
      // even when the feature is currently off.
      const probed = structuredClone(cfg);
      probed.skills = probed.skills || {};
      probed.skills.inspector = { ...mergedInspectorConfig(cfg), enabled: true };
      const out = await inspectPromptForSkills({
        prompt,
        projectPath: project_path,
        globalConfig: probed,
      });
      res.json({ trace: out.trace, contextNote: out.contextNote });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });
}
