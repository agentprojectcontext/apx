import { http } from "../http";

export type SkillEntry = {
  slug: string;
  source: "bundled" | "user" | "project" | string;
  description: string;
};

export type SkillsList = {
  count: number;
  skills: SkillEntry[];
};

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
   * List installed skills (bundled + user + optional project-scoped). The
   * description is already condensed for one-line rendering.
   */
  list: (projectPath?: string) =>
    http.get<SkillsList>(
      projectPath
        ? `/skills?project_path=${encodeURIComponent(projectPath)}`
        : "/skills",
    ),

  /** Skill Inspector config + index status. */
  inspector: () => http.get<InspectorState>("/skills/inspector"),

  /** Patch inspector config (toggle / tune thresholds). */
  updateInspector: (patch: Partial<InspectorConfig>) =>
    http.put<{ ok: boolean; config: InspectorConfig; index: IndexStatus }>(
      "/skills/inspector",
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
