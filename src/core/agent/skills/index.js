// Public entrypoint for skills.
export { condenseSkillDescription, buildSkillsHintBlock } from "./catalog.js";
export { tryResolveSkillCommand } from "./trigger.js";
export { suggestSkillForPrompt, clearSkillVectorCache } from "./rag.js";
export { listSkills, loadSkill, SKILL_LOCATIONS } from "./loader.js";
export {
  isPrivateSkill,
  isSkillEnabled,
  filterEnabledSkills,
  annotateSkills,
  setSkillEnabled,
  resolveScopeKey,
  DEFAULT_SCOPE,
} from "./policy.js";
export {
  inspectPromptForSkills,
  isInspectorEnabled,
  INSPECTOR_DEFAULTS,
  summarizeTrace,
} from "./inspector.js";
export {
  ensureIndex,
  planIndex,
  readIndex,
  clearIndex,
  indexPath,
  backgroundRefreshIfStale,
  awaitRefresh,
} from "./index-store.js";
