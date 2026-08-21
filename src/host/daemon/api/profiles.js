// GET    /profiles                 installed + bundled packages, which one is active
// GET    /profiles/doctor          health of the active profile (or ?id=)
// GET    /profiles/:id             one package, with its schema, settings and prompt preview
// POST   /profiles/install         { source, force? }
// POST   /profiles/use             { id, force? }
// POST   /profiles/off
// PATCH  /profiles/config          { values: {...}, id? }
// DELETE /profiles/:id             uninstall
//
// Thin adapter — body → core/profiles → response. The daemon is the writer on
// purpose: activating a profile changes the live system prompt and the routine
// schedule, so the process that owns both has to be the one applying it.
import { readConfig } from "#core/config/index.js";
import { readIdentity } from "#core/identity/index.js";
import {
  listProfilesWithState,
  readProfile,
  readProfileState,
  effectiveProfileConfig,
  localizeProfileSchema,
  installProfile,
  useProfile,
  offProfile,
  syncProfile,
  setProfileConfig,
  uninstallProfile,
  profileDoctor,
  renderProfilePrompt,
  estimateTokens,
} from "#core/profiles/index.js";

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
  const profile = readProfile(id);
  if (!profile) return null;

  const cfg = readConfig();
  const state = readProfileState(cfg);
  const identity = (() => { try { return readIdentity(); } catch { return null; } })();
  const settings = effectiveProfileConfig(profile, cfg);
  const lang = cfg?.user?.language || identity?.language || "en";

  const languages = profile.prompts.map((f) => {
    const m = f.match(/^PROFILE\.([\w-]+)\.md$/);
    return m ? m[1] : "en";
  });

  const rendered = preview
    ? renderProfilePrompt(profile, {
        identity,
        globalConfig: { ...cfg, profile: { active: id, config: settings } },
        lang,
      })
    : "";

  return {
    id: profile.id,
    name: profile.manifest.name || profile.id,
    version: profile.manifest.version || null,
    description: profile.manifest.description || "",
    author: profile.manifest.author || null,
    source: profile.source,
    dir: profile.dir,
    active: state.active === id,
    languages: [...new Set(languages)].sort(),
    provides: profile.manifest.provides || {},
    requires: profile.manifest.requires || {},
    schema: localizeProfileSchema(profile.dir, profile.schema, lang),
    defaults: profile.defaults,
    config: settings,
    budget: profile.manifest.prompt_budget_tokens || null,
    tokens: preview ? estimateTokens(rendered) : null,
    // The rendered block, exactly as it reaches the model. This is the best
    // debugging tool the panel can offer and it costs nothing to expose.
    preview: rendered,
  };
}

export function register(api) {
  api.get("/profiles", (_req, res) => {
    try {
      const cfg = readConfig();
      res.json({
        active: readProfileState(cfg).active,
        profiles: listProfilesWithState(cfg),
      });
    } catch (e) {
      fail(res, e);
    }
  });

  // Registered before /profiles/:id so "doctor" isn't swallowed as an id.
  api.get("/profiles/doctor", (req, res) => {
    try {
      res.json(profileDoctor(req.query?.id || null));
    } catch (e) {
      fail(res, e);
    }
  });

  api.get("/profiles/:id", (req, res) => {
    try {
      const out = detail(req.params.id, { preview: req.query?.preview !== "0" });
      if (!out) return res.status(404).json({ error: `profile "${req.params.id}" not found` });
      res.json(out);
    } catch (e) {
      fail(res, e);
    }
  });

  api.post("/profiles/install", (req, res) => {
    try {
      const { source, force } = req.body || {};
      if (!source) return res.status(400).json({ error: "body needs { source }" });
      const out = installProfile(source, { force: !!force });
      res.json({
        ok: true,
        profile: detail(out.profile.id),
        warnings: out.warnings,
        tokens: out.tokens,
        doctor: out.doctor,
      });
    } catch (e) {
      fail(res, e);
    }
  });

  api.post("/profiles/use", (req, res) => {
    try {
      const { id, force } = req.body || {};
      if (!id) return res.status(400).json({ error: "body needs { id }" });
      const out = useProfile(id, { confirmReplace: !!force });
      res.json({
        ok: true,
        profile: detail(id),
        routines: out.routines,
        warnings: out.warnings,
        tokens: out.tokens,
      });
    } catch (e) {
      fail(res, e);
    }
  });

  // Re-render the active package's routines from disk. Separate from `use`
  // because re-activating is a bigger, noisier operation than "pick up the
  // package as it is today", and an owner who just updated APX wants the second.
  api.post("/profiles/sync", (req, res) => {
    try {
      res.json({ ok: true, ...syncProfile(req.body?.id || null) });
    } catch (e) {
      fail(res, e);
    }
  });

  api.post("/profiles/off", (_req, res) => {
    try {
      res.json({ ok: true, ...offProfile() });
    } catch (e) {
      fail(res, e);
    }
  });

  api.patch("/profiles/config", (req, res) => {
    try {
      const { values, id } = req.body || {};
      if (!values || typeof values !== "object") {
        return res.status(400).json({ error: "body needs { values: { key: value } }" });
      }
      const out = setProfileConfig(values, { id: id || null });
      res.json({ ok: true, ...out });
    } catch (e) {
      fail(res, e);
    }
  });

  api.delete("/profiles/:id", (req, res) => {
    try {
      res.json({ ok: true, ...uninstallProfile(req.params.id) });
    } catch (e) {
      fail(res, e);
    }
  });
}
