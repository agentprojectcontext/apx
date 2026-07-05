// `/skills` listing + enable/disable + Skill Inspector control surface.
//
//   GET    /skills                     catalog annotated with enabled/private per scope
//   PUT    /skills/enabled             toggle a skill on/off (or clear) for a scope
//   POST   /skills                     create a user skill (~/.apx/skills/<slug>/)
//   DELETE /skills/:slug               delete a user skill
//   GET    /skills/inspector           inspector config + index status
//   PUT    /skills/inspector           toggle / tune inspector config
//   POST   /skills/index               (re)build the inspector vector index
//   POST   /skills/inspect             dry-run the inspector for a prompt
//
// A "scope" is either "default" (the super-agent / no-project baseline) or a
// project's absolute path. Built-in skills are private: always active, never
// disableable or deletable. The inspector routes mirror /embeddings/* so the web
// admin can configure the skill RAG exactly like it configures the memory RAG.
import fs from "node:fs";
import path from "node:path";
import { listSkills, loadSkill, SKILL_LOCATIONS } from "#core/agent/skills/loader.js";
import { condenseSkillDescription } from "#core/agent/skills/catalog.js";
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

const KNOWN_KEYS = Object.keys(INSPECTOR_DEFAULTS);

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

  // ---- Create / delete user skills ---------------------------------------

  app.post("/skills", (req, res) => {
    try {
      const { slug, description, body } = req.body || {};
      if (!slug || typeof slug !== "string" || !SLUG_RE.test(slug)) {
        return res.status(400).json({ error: "slug required (lowercase letters, digits, dashes)" });
      }
      if (listSkills().some((s) => s.slug === slug)) {
        return res.status(409).json({ error: `a skill named "${slug}" already exists` });
      }
      const dir = path.join(SKILL_LOCATIONS.global, slug);
      fs.mkdirSync(dir, { recursive: true });
      const fmDesc = String(description || "").replace(/\n/g, " ").trim();
      const content =
        `---\nname: ${slug}\ndescription: ${fmDesc}\n---\n\n` +
        `${String(body || "").trim()}\n`;
      fs.writeFileSync(path.join(dir, "SKILL.md"), content, "utf8");
      res.status(201).json({ ok: true, slug, source: "global" });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  app.delete("/skills/:slug", (req, res) => {
    try {
      const slug = req.params.slug;
      if (!slug || !SLUG_RE.test(slug)) {
        return res.status(400).json({ error: "invalid slug" });
      }
      let entry;
      try { entry = loadSkill(slug); } catch { entry = null; }
      if (!entry) return res.status(404).json({ error: `skill "${slug}" not found` });
      if (entry.source !== "global") {
        return res.status(403).json({ error: `only user-installed (global) skills can be deleted; "${slug}" is ${entry.source}` });
      }
      // The skill dir is the parent of its SKILL.md (dir-style) — never the
      // shared global root itself.
      const dir = path.dirname(entry.file);
      if (path.resolve(dir) === path.resolve(SKILL_LOCATIONS.global)) {
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
