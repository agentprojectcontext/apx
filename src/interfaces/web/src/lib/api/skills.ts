import { http } from "../http";

export type SkillSource = "builtin" | "global" | "project" | string;

export type SkillEntry = {
  slug: string;
  source: SkillSource;
  description: string;
  /** Effective enabled state for the requested scope. */
  enabled?: boolean;
  /** Built-in APX skill — always active, never disableable. */
  private?: boolean;
  /** Whether THIS scope holds an explicit override (vs. inherited). */
  overridden?: boolean;
};

export type SkillsList = {
  count: number;
  /** Echoed scope key: "default" (super-agent) or a project path. */
  scope?: string;
  skills: SkillEntry[];
};

export interface SkillDetail {
  slug: string;
  source: SkillSource;
  description: string;
  frontmatter: Record<string, string>;
  body: string;
  file: string;
  enabled: boolean;
  private: boolean;
  overridden: boolean;
}

export interface CreateResult {
  ok: boolean;
  slug: string;
  source: string;
}

export interface InspectorConfig {
  enabled: boolean;
  load_threshold: number;
  hint_threshold: number;
  margin: number;
  max_loaded: number;
  max_hints: number;
  prompt_floor: number;
  body_char_cap: number;
}

export interface IndexStatus {
  count: number;
  embedder: string | null;
  dim: number | null;
  updated_at: string | null;
}

export interface InspectorState {
  config: InspectorConfig;
  defaults: InspectorConfig;
  keys: string[];
  index: IndexStatus;
}

export interface IndexResult {
  ok: boolean;
  embedder: string;
  dim: number;
  planned: { missing: number; stale: number; gone: number; total: number };
  changed: { added: number; refreshed: number; removed: number; kept: number };
  index: IndexStatus;
}

export interface KeywordTriggerConfig {
  enabled: boolean;
  max_matches: number;
  body_char_cap: number;
}

export interface KeywordTriggerSkill {
  slug: string;
  source: SkillSource;
  triggers: string[];
  enabled: boolean;
  private: boolean;
}

export interface KeywordTriggerState {
  config: KeywordTriggerConfig;
  defaults: KeywordTriggerConfig;
  keys: string[];
  skills: KeywordTriggerSkill[];
}

export interface InspectTrace {
  enabled: boolean;
  reason?: string;
  embedder?: string;
  scored?: { slug: string; sim: number }[];
  loaded?: string[];
  hinted?: string[];
  jit?: boolean;
}

export interface InspectResult {
  trace: InspectTrace;
  contextNote: string;
}

export const Skills = {
  /**
   * List installed skills (built-in + user + optional project-scoped), each
   * annotated with `enabled`/`private` for the requested scope. Pass a project
   * path to both scan that project's skills AND resolve enabled-state against
   * it; omit it for the super-agent ("default") scope.
   */
  list: (projectPath?: string) => {
    const qs = new URLSearchParams();
    if (projectPath) {
      qs.set("project_path", projectPath);
      qs.set("scope", projectPath);
    }
    const q = qs.toString();
    return http.get<SkillsList>(q ? `/skills?${q}` : "/skills");
  },

  /** Full body + frontmatter of a skill, for the viewer. */
  detail: (slug: string, projectPath?: string) => {
    const qs = projectPath ? `?project_path=${encodeURIComponent(projectPath)}` : "";
    return http.get<SkillDetail>(`/skills/${encodeURIComponent(slug)}/detail${qs}`);
  },

  /**
   * Enable/disable a skill for a scope. `enabled: null` clears the override so
   * the skill inherits the super-agent default again. `scope` is "default" or a
   * project path.
   */
  setEnabled: (body: { slug: string; enabled: boolean | null; scope?: string }) =>
    http.put<{ ok: boolean; slug: string; scope: string; enabled: boolean | null }>(
      "/skills/enabled",
      body,
    ),

  /**
   * Create a user skill from the online editor. With `project_path` it lands in
   * that project's .apc/skills/; otherwise in ~/.apx/skills/.
   */
  create: (body: { slug: string; description?: string; body?: string; project_path?: string }) =>
    http.post<CreateResult>("/skills", body),

  /** Import a skill from an uploaded .zip (base64-encoded). */
  importZip: (body: { data: string; project_path?: string }) =>
    http.post<CreateResult>("/skills/import/zip", body),

  /** Import a skill by cloning a git repo. */
  importRepo: (body: { url: string; project_path?: string }) =>
    http.post<CreateResult>("/skills/import/repo", body),

  /** Delete a user skill (global or project-scoped). */
  remove: (slug: string, projectPath?: string) => {
    const qs = projectPath ? `?project_path=${encodeURIComponent(projectPath)}` : "";
    return http.del<{ ok: boolean; slug: string }>(`/skills/${encodeURIComponent(slug)}${qs}`);
  },

  /** Skill Inspector config + index status. */
  inspector: () => http.get<InspectorState>("/skills/inspector"),

  /** Patch inspector config (toggle / tune thresholds). */
  updateInspector: (patch: Partial<InspectorConfig>) =>
    http.put<{ ok: boolean; config: InspectorConfig; index: IndexStatus }>(
      "/skills/inspector",
      patch,
    ),

  /** Keyword-trigger config + the skills that declare `triggers:`. */
  keywordTriggers: (projectPath?: string) => {
    const qs = projectPath ? `?project_path=${encodeURIComponent(projectPath)}` : "";
    return http.get<KeywordTriggerState>(`/skills/keyword-triggers${qs}`);
  },

  /** Patch keyword-trigger config (toggle / tune caps). */
  updateKeywordTriggers: (patch: Partial<KeywordTriggerConfig>) =>
    http.put<{ ok: boolean; config: KeywordTriggerConfig }>(
      "/skills/keyword-triggers",
      patch,
    ),

  /** (Re)build the inspector vector index. */
  index: (body: { project_path?: string; force?: boolean } = {}) =>
    http.post<IndexResult>("/skills/index", body),

  /** Dry-run the inspector for a prompt (forces enabled). */
  inspect: (prompt: string, projectPath?: string) =>
    http.post<InspectResult>("/skills/inspect", {
      prompt,
      project_path: projectPath,
    }),
};
