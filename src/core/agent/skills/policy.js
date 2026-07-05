// Skills enable/disable policy — scope-aware gating shared by every consumer.
//
// A skill can be turned off per scope. A "scope" is either the super-agent /
// no-project baseline ("default") or a specific project (keyed by its absolute
// path). Config lives at:
//
//   config.skills.policy["default"]        = { "<slug>": true|false, ... }
//   config.skills.policy["<projectPath>"]  = { "<slug>": true|false, ... }
//
// A boolean under a scope is an explicit override; an absent slug inherits.
// Empty/missing policy = every skill enabled (the pre-feature behavior), so this
// is fully backward compatible.
//
// PRIVATE skills (source "builtin") are APX's own shipped skills. They are
// always active and can never be disabled or deleted — the UI shows them locked.
//
// Effective enabled(skill, projectPath):
//   1. builtin source                → true (private, locked)
//   2. project scope explicit value  → that value
//   3. "default" scope explicit value→ that value
//   4. otherwise                     → true

export const DEFAULT_SCOPE = "default";

// Sources whose skills ship with apx and are always active.
const PRIVATE_SOURCES = new Set(["builtin"]);

/** True for APX's own built-in skills — always active, never disableable. */
export function isPrivateSkill(skill) {
  return PRIVATE_SOURCES.has(skill?.source);
}

/** Normalize a project path (or nothing) into a policy scope key. */
export function resolveScopeKey(projectPath) {
  const p = typeof projectPath === "string" ? projectPath.trim() : "";
  return p || DEFAULT_SCOPE;
}

function policyMap(config) {
  const p = config?.skills?.policy;
  return p && typeof p === "object" ? p : {};
}

function scopeOverride(config, scopeKey, slug) {
  const scope = policyMap(config)[scopeKey];
  if (!scope || typeof scope !== "object") return undefined;
  const v = scope[slug];
  return typeof v === "boolean" ? v : undefined;
}

/**
 * Resolve whether a skill is enabled for the given scope.
 * @param {{slug:string, source?:string}} skill
 * @param {{config?:object, projectPath?:string}} ctx
 * @returns {boolean}
 */
export function isSkillEnabled(skill, { config, projectPath } = {}) {
  if (isPrivateSkill(skill)) return true;
  const slug = skill?.slug;
  if (!slug) return true;

  const scopeKey = resolveScopeKey(projectPath);
  if (scopeKey !== DEFAULT_SCOPE) {
    const own = scopeOverride(config, scopeKey, slug);
    if (own !== undefined) return own;
  }
  const base = scopeOverride(config, DEFAULT_SCOPE, slug);
  if (base !== undefined) return base;
  return true;
}

/** Keep only the skills enabled for the given scope. */
export function filterEnabledSkills(skills, ctx = {}) {
  if (!Array.isArray(skills)) return [];
  return skills.filter((s) => isSkillEnabled(s, ctx));
}

/**
 * Annotate skills for a UI client: adds `enabled`, `private`, and `overridden`
 * (whether *this* scope holds an explicit override, ignoring inheritance).
 */
export function annotateSkills(skills, { config, projectPath } = {}) {
  if (!Array.isArray(skills)) return [];
  const scopeKey = resolveScopeKey(projectPath);
  return skills.map((s) => {
    const priv = isPrivateSkill(s);
    const own = priv ? undefined : scopeOverride(config, scopeKey, s.slug);
    return {
      ...s,
      private: priv,
      enabled: isSkillEnabled(s, { config, projectPath }),
      overridden: own !== undefined,
    };
  });
}

/**
 * Set (or clear) a skill's enabled override for a scope. Mutates and returns the
 * config object. `enabled === null|undefined` clears the override (back to
 * inherit). Private/builtin skills cannot be overridden.
 *
 * @param {object} config          the global config (mutated in place)
 * @param {object} args
 * @param {string} args.slug
 * @param {boolean|null} args.enabled
 * @param {string=} args.scope     scope key ("default" or a project path)
 * @param {string=} args.projectPath alternative to scope; normalized to a key
 */
export function setSkillEnabled(config, { slug, enabled, scope, projectPath } = {}) {
  if (!slug) throw new Error("setSkillEnabled: slug required");
  const scopeKey = scope ? resolveScopeKey(scope) : resolveScopeKey(projectPath);

  config.skills = config.skills || {};
  config.skills.policy = config.skills.policy || {};
  const map = config.skills.policy;

  if (enabled === null || enabled === undefined) {
    if (map[scopeKey]) {
      delete map[scopeKey][slug];
      if (Object.keys(map[scopeKey]).length === 0) delete map[scopeKey];
    }
    return config;
  }

  map[scopeKey] = map[scopeKey] || {};
  map[scopeKey][slug] = !!enabled;
  return config;
}
