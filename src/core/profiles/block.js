// The profile prompt block.
//
// Injected by buildSuperAgentSystem() between the owner/identity block and the
// user's own custom instructions: after identity because the profile needs to
// know who it serves, before custom instructions because anything the user
// writes themselves must win on recency.
//
// THE INVARIANT: with no profile active this returns "", and buildSuperAgentSystem
// filters empty blocks out — so a vanilla install's prompt is byte-identical to
// what it was before profiles existed. tests/profile-block.test.js guards it.
//
// Synchronous on purpose: buildSuperAgentSystem is sync and runs on every turn
// of every channel, so the prompt file is read with readFileSync and cached.
import fs from "node:fs";

import { renderPromptTemplate, findOrphanVars } from "../agent/render-template.js";
import {
  readActiveProfile,
  effectiveProfileConfig,
  resolvePromptFile,
} from "./store.js";

// Rendered blocks, keyed by everything that can change one. Bounded by the
// number of profiles × languages, which is tiny.
const cache = new Map();

/** Neutral stand-ins, so an unconfigured install never renders broken prose. */
const NEUTRAL = {
  owner_name: "the owner",
  agent_name: "the agent",
};

export function clearProfileBlockCache() {
  cache.clear();
}

/**
 * Variables available to PROFILE.md. The profile's own settings, plus a few
 * read-only facts from identity.json.
 *
 * Note the split of responsibility: identity.json owns WHO the owner is and
 * what the agent is called; the profile config owns HOW the agent behaves.
 * `owner_name` is therefore read from identity, never duplicated into the
 * profile's config.
 */
export function profileTemplateVars(profile, identity, globalConfig) {
  const settings = effectiveProfileConfig(profile, globalConfig);
  return {
    ...settings,
    owner_name: identity?.owner_name || NEUTRAL.owner_name,
    owner_context: identity?.owner_context || "",
    agent_name:
      identity?.agent_name || globalConfig?.super_agent?.name || NEUTRAL.agent_name,
    profile_name: profile?.manifest?.name || profile?.id || "",
  };
}

/**
 * Render a profile package's prompt for a language.
 * Exported for `apx profile show --preview` and the web panel's preview pane.
 */
export function renderProfilePrompt(profile, { identity = null, globalConfig = {}, lang = "en" } = {}) {
  if (!profile) return "";

  const file = resolvePromptFile(profile.dir, lang);
  if (!file) return "";

  let template;
  try {
    template = fs.readFileSync(file, "utf8").trim();
  } catch {
    return "";
  }
  if (!template) return "";

  const vars = profileTemplateVars(profile, identity, globalConfig);
  let rendered = renderPromptTemplate(template, vars);

  // renderPromptTemplate only understands {{word}}. Anything else — a dotted
  // path, a typo, stray whitespace — survives it and would reach the model as
  // literal braces. A visible {{…}} in the prompt is a severity-high bug, so
  // strip them and say which package is at fault rather than shipping them.
  const orphans = findOrphanVars(rendered);
  if (orphans.length > 0) {
    // eslint-disable-next-line no-console
    console.warn(
      `[apx] profile "${profile.id}": ${orphans.length} unresolved template ` +
      `variable(s) removed from the prompt — ${[...new Set(orphans)].join(", ")}. ` +
      `Only {{single_word}} names are substituted.`
    );
    rendered = rendered.replace(/\{\{[^}]*\}\}/g, "").replace(/[ \t]{2,}/g, " ");
  }

  return rendered.trim();
}

/**
 * The block as it goes into the super-agent system prompt.
 * Returns "" when no profile is active — the vanilla case.
 */
export function buildProfileBlock(identity, globalConfig = {}) {
  const profile = readActiveProfile(globalConfig);
  if (!profile) return "";

  const lang = globalConfig?.user?.language || identity?.language || "en";
  const file = resolvePromptFile(profile.dir, lang);
  if (!file) return "";

  let mtime = 0;
  try {
    mtime = fs.statSync(file).mtimeMs;
  } catch {
    return "";
  }

  const vars = profileTemplateVars(profile, identity, globalConfig);
  const key = `${profile.id}|${file}|${mtime}|${JSON.stringify(vars)}`;
  if (cache.has(key)) return cache.get(key);

  const body = renderProfilePrompt(profile, { identity, globalConfig, lang });
  const block = body ? body : "";
  cache.set(key, block);
  return block;
}
