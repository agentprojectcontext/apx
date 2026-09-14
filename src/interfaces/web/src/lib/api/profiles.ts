import { http } from "../http";

/** A property of a profile's config.schema.json (the supported subset). */
export type ProfileSchemaProp = {
  type?: "string" | "integer" | "number" | "boolean";
  enum?: (string | number | boolean)[];
  default?: string | number | boolean;
  title?: string;
  description?: string;
};

export type ProfileSchema = {
  type?: string;
  properties?: Record<string, ProfileSchemaProp>;
};

export type ProfileSummary = {
  id: string;
  name: string;
  version: string | null;
  description: string;
  author: string | null;
  languages: string[];
  source: "bundled" | "user" | "user-override";
  active: boolean;
  dir: string;
};

export type ProfileDetail = ProfileSummary & {
  provides: Record<string, string[]>;
  requires: Record<string, string[]>;
  schema: ProfileSchema | null;
  defaults: Record<string, unknown>;
  config: Record<string, unknown>;
  budget: number | null;
  tokens: number | null;
  /** The rendered prompt block, exactly as it reaches the model. */
  preview: string;
};

export type ProfileCheck = {
  level: "error" | "warn";
  label: string;
  detail: string;
  fix: string | null;
  /** Set on routine-drift checks: the routine a targeted re-adopt would repair. */
  routine?: string | null;
};

export type ProfileDoctor = {
  id: string | null;
  active: boolean;
  ok: boolean;
  tokens?: number;
  budget?: number | null;
  checks: ProfileCheck[];
  summary: string;
};

export type ProfileRoutineSync = {
  installed: string[];
  skipped: { name: string; reason: string }[];
};

/** One project-scoped package, as offered to a project that could run it. */
export type ProjectProfileOption = {
  id: string;
  name: string;
  description: string;
  version: string | null;
  source: "bundled" | "user" | "user-override";
  provides: Record<string, string[]>;
  /** The agent slugs this package's routines address, resolved for this project. */
  agents: string[];
  active: boolean;
};

export type ProjectProfileState = {
  /** The package this project runs, or null for vanilla. */
  active: string | null;
  settings: Record<string, unknown>;
  available: ProjectProfileOption[];
};

/**
 * A PROJECT's profile — the same package format as the super-agent's, activated
 * by one project instead of by the machine. This is what turns a project marked
 * `kind: company` into one that actually operates like a company: the rituals
 * (daily pulse, weekly review, decision brief, scorecard) and the council's own
 * runs are routines the package installs.
 *
 * Its own client rather than a scope flag on ProfilesApi: the two never share a
 * target, and mixing them is how you end up deactivating the super-agent's
 * profile while trying to set up a project.
 *
 * `activate`/`deactivate` rather than core's `use`/`off`: a method called `use`
 * reads as a React hook to the linter at every call site, and losing that fight
 * once per caller is worse than one name that does not match the CLI's verb.
 */
export const ProjectProfiles = {
  get: (pid: string) => http.get<ProjectProfileState>(`/api/projects/${encodeURIComponent(pid)}/profile`),
  activate: (pid: string, id: string, force = false) =>
    http.post<ProjectProfileState & { ok: true; routines: ProfileRoutineSync }>(
      `/api/projects/${encodeURIComponent(pid)}/profile`,
      { id, force },
    ),
  deactivate: (pid: string) =>
    http.del<ProjectProfileState & { ok: true; disabled: string[] }>(
      `/api/projects/${encodeURIComponent(pid)}/profile`,
    ),
};

export const ProfilesApi = {
  list: () => http.get<{ active: string | null; profiles: ProfileSummary[] }>("/api/profiles"),
  get: (id: string) => http.get<ProfileDetail>(`/api/profiles/${encodeURIComponent(id)}`),
  doctor: (id?: string) =>
    http.get<ProfileDoctor>(`/api/profiles/doctor${id ? `?id=${encodeURIComponent(id)}` : ""}`),
  install: (source: string, force = false) =>
    http.post<{ ok: true; profile: ProfileDetail; warnings: string[]; tokens: number }>(
      "/api/profiles/install",
      { source, force }
    ),
  use: (id: string, force = false) =>
    http.post<{ ok: true; profile: ProfileDetail; routines: ProfileRoutineSync; warnings: string[] }>(
      "/api/profiles/use",
      { id, force }
    ),
  off: () => http.post<{ ok: true; was: string | null; routines: string[] }>("/api/profiles/off", {}),
  setConfig: (values: Record<string, unknown>, id?: string) =>
    http.patch<{ ok: true; config: Record<string, unknown>; changed: string[]; routines: ProfileRoutineSync }>(
      "/api/profiles/config",
      { values, id }
    ),
  uninstall: (id: string) =>
    http.del<{ ok: true; id: string; source: string }>(`/api/profiles/${encodeURIComponent(id)}`),
  /**
   * Force the active profile's routines back to the package, past the skips sync
   * respects. Pass a routine name to re-adopt just that one; omit it for all.
   * Discards local edits to the affected routines.
   */
  readopt: (routine?: string) =>
    http.post<{ ok: true; id: string; version: string | null; readopted: string[] }>(
      "/api/profiles/readopt",
      routine ? { routine } : {}
    ),
};
