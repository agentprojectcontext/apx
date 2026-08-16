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

export const ProfilesApi = {
  list: () => http.get<{ active: string | null; profiles: ProfileSummary[] }>("/profiles"),
  get: (id: string) => http.get<ProfileDetail>(`/profiles/${encodeURIComponent(id)}`),
  doctor: (id?: string) =>
    http.get<ProfileDoctor>(`/profiles/doctor${id ? `?id=${encodeURIComponent(id)}` : ""}`),
  install: (source: string, force = false) =>
    http.post<{ ok: true; profile: ProfileDetail; warnings: string[]; tokens: number }>(
      "/profiles/install",
      { source, force }
    ),
  use: (id: string, force = false) =>
    http.post<{ ok: true; profile: ProfileDetail; routines: ProfileRoutineSync; warnings: string[] }>(
      "/profiles/use",
      { id, force }
    ),
  off: () => http.post<{ ok: true; was: string | null; routines: string[] }>("/profiles/off", {}),
  setConfig: (values: Record<string, unknown>, id?: string) =>
    http.patch<{ ok: true; config: Record<string, unknown>; changed: string[]; routines: ProfileRoutineSync }>(
      "/profiles/config",
      { values, id }
    ),
  uninstall: (id: string) =>
    http.del<{ ok: true; id: string; source: string }>(`/profiles/${encodeURIComponent(id)}`),
};
