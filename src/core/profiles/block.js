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
import path from "node:path";

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

/**
 * Variables every profile template can rely on, whether or not the user has
 * configured anything. The value is what fills in when the real one is absent.
 * `owner_context` is legitimately empty for most people, so it resolves to "".
 */
export const BUILTIN_VARS = Object.freeze({
  owner_name: NEUTRAL.owner_name,
  agent_name: NEUTRAL.agent_name,
  owner_context: "",
  profile_name: "",
});

export function clearProfileBlockCache() {
  cache.clear();
}

/**
 * Check that a template only uses variables that will actually resolve.
 *
 * This is the INSTALL gate, and it is deliberately stricter than the renderer's
 * safety net: the renderer strips a stray `{{…}}` at runtime, but by then the
 * package is already installed and a "You are 's chief of staff." has already
 * reached somebody's phone. Failing here means it never gets that far.
 *
 * Two ways a template fails:
 *   - a `{{…}}` the renderer's `\w+` regex cannot match (a dotted path, spaces,
 *     a typo) — it would survive into the prompt verbatim;
 *   - a `{{word}}` that is neither a built-in nor a schema property WITH a
 *     default — it would silently render as an empty string.
 *
 * @returns {{ ok: boolean, errors: string[], used: string[] }}
 */
export function validateTemplateVars(template, schema) {
  const errors = [];
  const text = String(template || "");

  const malformed = [
    ...new Set(
      [...text.matchAll(/\{\{[^}]*\}\}/g)]
        .map((m) => m[0])
        .filter((raw) => !/^\{\{\w+\}\}$/.test(raw))
    ),
  ];
  for (const raw of malformed) {
    errors.push(
      `template variable ${raw} cannot be substituted — only flat {{single_word}} ` +
      `names are supported (no dots, spaces or punctuation)`
    );
  }

  const props = schema?.properties || {};
  const resolvable = new Set([
    ...Object.keys(BUILTIN_VARS),
    ...Object.keys(props).filter((k) => props[k]?.default !== undefined),
  ]);

  const used = [...new Set([...text.matchAll(/\{\{(\w+)\}\}/g)].map((m) => m[1]))];
  for (const name of used) {
    if (resolvable.has(name)) continue;
    const declaredWithoutDefault = Object.hasOwn(props, name);
    errors.push(
      declaredWithoutDefault
        ? `template uses {{${name}}}, which is declared in config.schema.json but has ` +
          `no default — it would render as an empty string`
        : `template uses {{${name}}}, which is neither a built-in ` +
          `(${Object.keys(BUILTIN_VARS).join(", ")}) nor a property of config.schema.json`
    );
  }

  return { ok: errors.length === 0, errors, used };
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

// ---------------------------------------------------------------------------
// Channel overlays
// ---------------------------------------------------------------------------
//
// A profile can ship profiles/<id>/channels/<ch>.md, rendered and appended
// AFTER the core channel file for that surface. The core file still owns the
// channel's formatting rules; the overlay adds the profile's judgement for that
// specific surface.
//
// This exists so a guardrail can be deterministic without being always-on.
// The judgement a profile needs when a routine fires — the gates it must pass
// before speaking unprompted, its signal catalogue, its interruption budget —
// is exactly the judgement that must NOT live in an on-demand skill: deciding
// "should I interrupt?" is a decision the model may not know it is about to
// take, so it cannot be trusted to go and fetch the rule first. Putting it in
// channels/routine.md loads it precisely when a routine runs, and costs nothing
// on telegram, cli, web or desktop.
//
// buildChannelContextBlock() is untouched — this is a sibling the prompt
// builder concatenates, not a change to how core channel files are resolved.

/** Path of a profile's overlay for a channel, or null when it has none. */
export function profileChannelFile(profileDir, channel) {
  const ch = String(channel || "").toLowerCase();
  if (!ch || !/^[a-z_]+$/.test(ch)) return null;
  const file = path.join(profileDir, "channels", `${ch}.md`);
  return fs.existsSync(file) ? file : null;
}

/**
 * The active profile's overlay for a channel, rendered. "" when there is no
 * profile, no overlay for this channel, or the overlay is empty.
 *
 * @param channelMeta merged into the template vars so an overlay can use the
 *   same placeholders the core channel file does (routineName, projectPath, …).
 */
export function buildProfileChannelBlock(channel, identity, globalConfig = {}, channelMeta = {}) {
  const profile = readActiveProfile(globalConfig);
  if (!profile) return "";

  const file = profileChannelFile(profile.dir, channel);
  if (!file) return "";

  let raw = "";
  let mtime = 0;
  try {
    raw = fs.readFileSync(file, "utf8").trim();
    mtime = fs.statSync(file).mtimeMs;
  } catch {
    return "";
  }
  if (!raw) return "";

  const vars = { ...profileTemplateVars(profile, identity, globalConfig), ...channelMeta };
  const key = `ch|${profile.id}|${file}|${mtime}|${JSON.stringify(vars)}`;
  if (cache.has(key)) return cache.get(key);

  let out = renderPromptTemplate(raw, vars);
  const orphans = findOrphanVars(out);
  if (orphans.length > 0) {
    out = out.replace(/\{\{[^}]*\}\}/g, "").replace(/[ \t]{2,}/g, " ");
  }
  out = out.trim();
  cache.set(key, out);
  return out;
}
