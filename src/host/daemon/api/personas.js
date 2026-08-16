// GET    /personas                 installed + bundled packages, which one is active
// GET    /personas/doctor          health of the active persona (or ?id=)
// GET    /personas/:id             one package, with its schema, settings and prompt preview
// POST   /personas/install         { source, force? }
// POST   /personas/use             { id, force? }
// POST   /personas/off
// PATCH  /personas/config          { values: {...}, id? }
// DELETE /personas/:id             uninstall
//
// Thin adapter — body → core/personas → response. The daemon is the writer on
// purpose: activating a persona changes the live system prompt and the routine
// schedule, so the process that owns both has to be the one applying it.
import { readConfig } from "#core/config/index.js";
import { readIdentity } from "#core/identity/index.js";
import {
  listPersonasWithState,
  readPersona,
  readPersonaState,
  effectivePersonaConfig,
  installPersona,
  usePersona,
  offPersona,
  setPersonaConfig,
  uninstallPersona,
  personaDoctor,
  renderPersonaPrompt,
  estimateTokens,
} from "#core/personas/index.js";

/** 400 for anything the caller could have got right, 500 for the rest. */
function fail(res, e) {
  const msg = e?.message || String(e);
  const isUserError =
    /not installed|not found|invalid|unknown setting|must be|already|missing|required|not supported|cannot be activated|failed:/i.test(
      msg
    );
  res.status(isUserError ? 400 : 500).json({ error: msg });
}

function detail(id, { preview = true } = {}) {
  const persona = readPersona(id);
  if (!persona) return null;

  const cfg = readConfig();
  const state = readPersonaState(cfg);
  const identity = (() => { try { return readIdentity(); } catch { return null; } })();
  const settings = effectivePersonaConfig(persona, cfg);

  const languages = persona.prompts.map((f) => {
    const m = f.match(/^PERSONA\.([\w-]+)\.md$/);
    return m ? m[1] : "en";
  });

  const rendered = preview
    ? renderPersonaPrompt(persona, {
        identity,
        globalConfig: { ...cfg, persona: { active: id, config: settings } },
        lang: cfg?.user?.language || identity?.language || "en",
      })
    : "";

  return {
    id: persona.id,
    name: persona.manifest.name || persona.id,
    version: persona.manifest.version || null,
    description: persona.manifest.description || "",
    author: persona.manifest.author || null,
    source: persona.source,
    dir: persona.dir,
    active: state.active === id,
    languages: [...new Set(languages)].sort(),
    provides: persona.manifest.provides || {},
    requires: persona.manifest.requires || {},
    schema: persona.schema || null,
    defaults: persona.defaults,
    config: settings,
    budget: persona.manifest.prompt_budget_tokens || null,
    tokens: preview ? estimateTokens(rendered) : null,
    // The rendered block, exactly as it reaches the model. This is the best
    // debugging tool the panel can offer and it costs nothing to expose.
    preview: rendered,
  };
}

export function register(app) {
  app.get("/personas", (_req, res) => {
    try {
      const cfg = readConfig();
      res.json({
        active: readPersonaState(cfg).active,
        personas: listPersonasWithState(cfg),
      });
    } catch (e) {
      fail(res, e);
    }
  });

  // Registered before /personas/:id so "doctor" isn't swallowed as an id.
  app.get("/personas/doctor", (req, res) => {
    try {
      res.json(personaDoctor(req.query?.id || null));
    } catch (e) {
      fail(res, e);
    }
  });

  app.get("/personas/:id", (req, res) => {
    try {
      const out = detail(req.params.id, { preview: req.query?.preview !== "0" });
      if (!out) return res.status(404).json({ error: `persona "${req.params.id}" not found` });
      res.json(out);
    } catch (e) {
      fail(res, e);
    }
  });

  app.post("/personas/install", (req, res) => {
    try {
      const { source, force } = req.body || {};
      if (!source) return res.status(400).json({ error: "body needs { source }" });
      const out = installPersona(source, { force: !!force });
      res.json({
        ok: true,
        persona: detail(out.persona.id),
        warnings: out.warnings,
        tokens: out.tokens,
        doctor: out.doctor,
      });
    } catch (e) {
      fail(res, e);
    }
  });

  app.post("/personas/use", (req, res) => {
    try {
      const { id, force } = req.body || {};
      if (!id) return res.status(400).json({ error: "body needs { id }" });
      const out = usePersona(id, { confirmReplace: !!force });
      res.json({
        ok: true,
        persona: detail(id),
        routines: out.routines,
        warnings: out.warnings,
        tokens: out.tokens,
      });
    } catch (e) {
      fail(res, e);
    }
  });

  app.post("/personas/off", (_req, res) => {
    try {
      res.json({ ok: true, ...offPersona() });
    } catch (e) {
      fail(res, e);
    }
  });

  app.patch("/personas/config", (req, res) => {
    try {
      const { values, id } = req.body || {};
      if (!values || typeof values !== "object") {
        return res.status(400).json({ error: "body needs { values: { key: value } }" });
      }
      const out = setPersonaConfig(values, { id: id || null });
      res.json({ ok: true, ...out });
    } catch (e) {
      fail(res, e);
    }
  });

  app.delete("/personas/:id", (req, res) => {
    try {
      res.json({ ok: true, ...uninstallPersona(req.params.id) });
    } catch (e) {
      fail(res, e);
    }
  });
}
