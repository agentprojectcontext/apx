// GET    /projects/:pid/profile    what ONE project runs, and what it could run
// POST   /projects/:pid/profile    { id, force? }
// DELETE /projects/:pid/profile    stand the project's profile down
//
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
import fs from "node:fs";
import path from "node:path";

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
  readoptProfile,
  setProfileConfig,
  uninstallProfile,
  profileDoctor,
  renderProfilePrompt,
  estimateTokens,
  listProfiles,
  isProjectProfile,
  localizeProfileManifest,
} from "#core/profiles/index.js";
import {
  readProjectProfileState,
  projectProfileSettings,
  useProjectProfile,
  offProjectProfile,
} from "#core/profiles/project.js";

/** 400 for anything the caller could have got right, 500 for the rest. */
function fail(res, e) {
  const msg = e?.message || String(e);
  const isUserError =
    // `belongs to` is the wrong-scope refusal — activating a super-agent
    // package on a project. It is the caller's mistake, not the daemon's, and
    // without it here the panel got a 500 for picking the wrong package.
    /not installed|not found|invalid|unknown setting|must be|already|missing|required|not supported|cannot be activated|belongs to|failed:/i.test(
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

  // The package's own name and description, in the reader's language.
  const manifest = localizeProfileManifest(profile.dir, profile.manifest, lang);
  return {
    id: profile.id,
    name: manifest.name || profile.id,
    version: manifest.version || null,
    description: manifest.description || "",
    author: manifest.author || null,
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

/**
 * The agent slugs a package's routines will address, resolved against THIS
 * project's settings.
 *
 * Worth computing because the failure it catches is completely silent: the
 * company package's five council routines name `cfo`, `coo`, `cmo`, `chro` and
 * `gc` literally, and its four rituals name whatever `orchestrator_agent` says.
 * Activate it on a project that never imported those agents and you get nine
 * routines on a schedule, every one of them addressed to nobody — no error at
 * activation, and nothing to see until the runs start failing.
 *
 * Parsed raw rather than through renderProfileRoutines: that renders against
 * the SUPER-AGENT's settings, and the whole point here is the project's own.
 * `spec.agent` is a slug or one `{{setting}}`, so that is all this resolves.
 */
function profileRoutineAgents(profile, p) {
  let files;
  try {
    files = fs.readdirSync(path.join(profile.dir, "routines")).filter((f) => f.endsWith(".json"));
  } catch {
    return [];
  }
  const settings = projectProfileSettings(p.path, profile.id);
  const out = new Set();
  for (const file of files) {
    let raw;
    try {
      raw = JSON.parse(fs.readFileSync(path.join(profile.dir, "routines", file), "utf8"));
    } catch {
      continue;
    }
    const agent = raw?.spec?.agent;
    if (typeof agent !== "string" || !agent) continue;
    const resolved = agent.replace(/\{\{\s*([\w.]+)\s*\}\}/g, (_m, k) => String(settings[k] ?? "")).trim();
    if (resolved) out.add(resolved);
  }
  return [...out].sort();
}

/**
 * What ONE project runs, and what it could run instead.
 *
 * `available` is every installed package whose manifest says `scope: project` —
 * a super-agent profile is not an option here and offering it would only
 * produce the error useProjectProfile already raises.
 */
function projectProfileState(p) {
  const { active } = readProjectProfileState(p.path);
  const lang = readConfig()?.user?.language || "en";
  const available = listProfiles()
    .filter((profile) => isProjectProfile(profile))
    .map((profile) => {
      // Localized here for the same reason the schema is: a package names
      // itself, so the string travels with the package and not with the app.
      const manifest = localizeProfileManifest(profile.dir, profile.manifest, lang);
      return {
      id: profile.id,
      name: manifest?.name || profile.id,
      description: manifest?.description || "",
      version: manifest?.version || null,
      source: profile.source,
      provides: profile.manifest?.provides || {},
      agents: profileRoutineAgents(profile, p),
      active: active === profile.id,
      };
    });
  return { active, settings: active ? projectProfileSettings(p.path, active) : {}, available };
}

export function register(api, { project }) {
  // ---- Project-scoped profiles ---------------------------------------------
  //
  //   GET    /projects/:pid/profile   what this project runs, and what it could
  //   POST   /projects/:pid/profile   { id, force? }
  //   DELETE /projects/:pid/profile   stand it down, keep what it installed
  //
  // Their own routes rather than a `scope` flag on the ones below, because the
  // two halves write to different places: a super-agent profile changes the
  // live system prompt and the global routine schedule, a project's changes
  // that project's `.apc/project.json` and its own routine store. Until these
  // existed the panel could reach only the first half — `apx profile use
  // company --project x` was the ONLY way to make a project run like a company,
  // and nothing in the web said so, which is how a project could sit marked
  // `kind: company` with not one ritual running.
  api.get("/projects/:pid/profile", (req, res) => {
    const p = project(req, res);
    if (!p) return;
    try {
      res.json(projectProfileState(p));
    } catch (e) {
      fail(res, e);
    }
  });

  api.post("/projects/:pid/profile", (req, res) => {
    const p = project(req, res);
    if (!p) return;
    try {
      const { id, force } = req.body || {};
      if (!id) return res.status(400).json({ error: "body needs { id }" });
      const out = useProjectProfile(p, id, { confirmReplace: !!force, globalConfig: readConfig() });
      res.json({ ok: true, ...projectProfileState(p), routines: out.routines });
    } catch (e) {
      fail(res, e);
    }
  });

  api.delete("/projects/:pid/profile", (req, res) => {
    const p = project(req, res);
    if (!p) return;
    try {
      const out = offProjectProfile(p);
      res.json({ ok: true, ...projectProfileState(p), disabled: out.disabled || [] });
    } catch (e) {
      fail(res, e);
    }
  });

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

  // Force-re-adopt the active profile's routines from the package, past the
  // user_modified/user_owned skips that sync respects. `{ routine }` targets one;
  // omit it to re-adopt all. This is the recovery a non-CLI user needs when their
  // installed routines drifted (a hand-patched schedule, an origin gone null) and
  // sync keeps skipping them — the web equivalent of `remove` + `sync`.
  api.post("/profiles/readopt", (req, res) => {
    try {
      res.json({ ok: true, ...readoptProfile(req.body?.id || null, { only: req.body?.routine || null }) });
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
