// A profile activated by a PROJECT, not by the super-agent.
//
// Two layers, not one with a flag: the super-agent runs ONE profile for the
// whole machine (its line of work), and a project runs its own (how that
// company operates). They never compete — activating `company` on Appsi does
// not touch `secretary`, which is exactly the failure this avoids: installing
// the executive layer as a super-agent profile would have deactivated the
// chief of staff and changed how the super-agent behaves everywhere.
//
// What is reused, not rebuilt: the package format and its store (bundled ∪
// user, tombstones), manifest and template validation, the prompt renderer,
// and the routine rendering + sync — which is why those took a `storage`
// option instead of being copied here. What is new is only the two things
// that are genuinely per-project: where the activation is recorded, and where
// the routines land.
//
// The activation lives in `.apc/project.json`, next to `kind` and
// `agents.imported`, so it travels with the repo: clone the project on another
// machine and the team AND the way it operates come with it. Settings stay in
// the same file for now — a profile's settings are policy (how often to
// interrupt, how many deliveries a week), not secrets.
import fs from "node:fs";

import { apcProjectFile } from "#core/apc/paths.js";
import { projectStorageRoot } from "#core/config/paths.js";
import { readProfile, isProjectProfile, PROJECT_SCOPE, profileScope } from "./store.js";
import { schemaDefaults, validateConfigValues } from "./manifest.js";
import { clearProfileBlockCache, renderProfilePrompt } from "./block.js";
import {
  validateProfilePackage,
  syncProfileRoutines,
  disableProfileRoutines,
  removeProfileRoutines,
} from "./lifecycle.js";

export { PROJECT_SCOPE, profileScope, isProjectProfile };

function readProjectFile(projectPath) {
  try {
    return JSON.parse(fs.readFileSync(apcProjectFile(projectPath), "utf8"));
  } catch {
    return null;
  }
}

function writeProjectFile(projectPath, meta) {
  fs.writeFileSync(apcProjectFile(projectPath), `${JSON.stringify(meta, null, 2)}\n`);
}

/** `{ active, configs }` — never null, so callers can read it without guards. */
export function readProjectProfileState(projectPath) {
  const meta = readProjectFile(projectPath);
  const state = meta?.profile;
  return {
    active: typeof state?.active === "string" ? state.active : null,
    configs: state?.configs && typeof state.configs === "object" ? state.configs : {},
  };
}

/** The settings a project profile actually runs with: schema defaults + saved. */
export function projectProfileSettings(projectPath, id) {
  const profile = readProfile(id);
  const { configs } = readProjectProfileState(projectPath);
  return { ...schemaDefaults(profile?.schema), ...(configs[id] || {}) };
}

/** The active profile package of a project, or null. */
export function readActiveProjectProfile(projectPath) {
  const { active } = readProjectProfileState(projectPath);
  return active ? readProfile(active) : null;
}

/** Where this project's routines live — the same storage the scheduler walks. */
export function projectRoutineStorage(project) {
  if (project?.storagePath) return project.storagePath;
  const apxId = readProjectFile(project?.path ?? project)?.apx_id;
  if (!apxId) throw new Error("project has no apx_id — run `apx project add` first");
  return projectStorageRoot(apxId);
}

function persist(projectPath, { active, id, settings }) {
  const meta = readProjectFile(projectPath);
  if (!meta) throw new Error(`not an APC project: ${projectPath}`);
  const prev = meta.profile || {};
  meta.profile = {
    ...prev,
    active,
    configs: { ...(prev.configs || {}), ...(id ? { [id]: settings } : {}) },
  };
  writeProjectFile(projectPath, meta);
}

/**
 * Activate a profile for one project: validate the package, record it, and
 * install its routines into the project's own storage.
 *
 * @param {{path:string, storagePath?:string}} project
 * @param {string} id
 * @param {{confirmReplace?:boolean, globalConfig?:object}} opts
 */
export function useProjectProfile(project, id, { confirmReplace = false, globalConfig = {} } = {}) {
  const profile = readProfile(id);
  if (!profile) throw new Error(`profile "${id}" is not installed — run: apx profile install ${id}`);
  if (!isProjectProfile(profile)) {
    throw new Error(`profile "${id}" belongs to the super-agent, not to a project — run: apx profile use ${id}`);
  }

  const state = readProjectProfileState(project.path);
  if (state.active && state.active !== id && !confirmReplace) {
    throw new Error(
      `profile "${state.active}" is already active on this project. One at a time — re-run with --force to replace it.`,
    );
  }

  validateProfilePackage(profile, { globalConfig });

  const storage = projectRoutineStorage(project);
  if (state.active && state.active !== id) disableProfileRoutines(state.active, { storage });

  const settings = { ...schemaDefaults(profile.schema), ...(state.configs[id] || {}) };
  persist(project.path, { active: id, id, settings });
  clearProfileBlockCache();

  const routines = syncProfileRoutines(profile, globalConfig, { storage });
  return { id, routines, settings };
}

/** Stand the project's profile down without deleting anything it installed. */
export function offProjectProfile(project) {
  const { active } = readProjectProfileState(project.path);
  if (!active) return { active: null, disabled: [] };
  const disabled = disableProfileRoutines(active, { storage: projectRoutineStorage(project) });
  persist(project.path, { active: null });
  clearProfileBlockCache();
  return { active, disabled };
}

/** Uninstall: stand down, then drop the routines the user never edited. */
export function removeProjectProfile(project) {
  const { active } = readProjectProfileState(project.path);
  if (!active) return { active: null, removed: [], kept: [] };
  const out = removeProfileRoutines(active, { storage: projectRoutineStorage(project) });
  persist(project.path, { active: null });
  clearProfileBlockCache();
  return { active, ...out };
}

/** Change one or more settings of the project's active profile. */
export function setProjectProfileConfig(project, values, { id = null, globalConfig = {} } = {}) {
  const state = readProjectProfileState(project.path);
  const target = id || state.active;
  if (!target) throw new Error("no profile is active on this project");
  const profile = readProfile(target);
  if (!profile) throw new Error(`profile "${target}" is not installed`);

  const checked = validateConfigValues(profile.schema, values);
  if (!checked.ok) throw new Error(checked.errors.join("; "));

  const settings = {
    ...schemaDefaults(profile.schema),
    ...(state.configs[target] || {}),
    ...checked.value,
  };
  persist(project.path, { active: state.active, id: target, settings });
  clearProfileBlockCache();

  // A setting can render into a routine (a schedule, a command), so the
  // routines are re-rendered — otherwise changing "quiet hours" would move the
  // words in the prompt and leave the cron where it was.
  if (state.active === target) {
    syncProfileRoutines(profile, globalConfig, { storage: projectRoutineStorage(project) });
  }
  return settings;
}

/**
 * The block that goes into the system prompt of every agent OF THIS PROJECT.
 * "" when the project runs no profile — the vanilla case, byte for byte.
 */
export function buildProjectProfileBlock(projectPath, identity = null, globalConfig = {}) {
  if (!projectPath) return "";
  const { active } = readProjectProfileState(projectPath);
  if (!active) return "";
  const profile = readProfile(active);
  if (!profile) return "";

  const lang = globalConfig?.user?.language || identity?.language || "en";
  return renderProfilePrompt(profile, {
    identity,
    globalConfig,
    lang,
    settings: projectProfileSettings(projectPath, active),
  });
}
