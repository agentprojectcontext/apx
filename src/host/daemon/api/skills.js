// `/skills` listing + Skill Inspector control surface for UI clients.
//
//   GET  /skills                       catalog (slug + condensed description)
//   GET  /skills/inspector             inspector config + index status
//   PUT  /skills/inspector             toggle / tune inspector config
//   POST /skills/index                 (re)build the inspector vector index
//   POST /skills/inspect               dry-run the inspector for a prompt
//
// The listing is the same data backing `list_skills` (no auth-binding to a
// project). The inspector routes mirror /embeddings/* so the web admin can
// configure the skill RAG exactly like it configures the memory RAG.
import { listSkills } from "#core/agent/skills/loader.js";
import { condenseSkillDescription } from "#core/agent/skills/catalog.js";
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
    const projectPath = typeof req.query?.project_path === "string"
      ? req.query.project_path
      : undefined;
    try {
      const skills = listSkills({ projectPath });
      res.json({
        count: skills.length,
        skills: skills.map(({ slug, source, description }) => ({
          slug,
          source,
          description: condenseSkillDescription(description),
        })),
      });
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
