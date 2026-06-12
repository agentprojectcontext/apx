import { http } from "../http";

export type VarScope = "project" | "global";

export interface VarsList {
  scope_hint: VarScope;
  project: Record<string, string>;
  global: Record<string, string>;
  effective: Record<string, string>;
  sources: Record<string, VarScope>;
}

export interface VarDetail {
  name: string;
  scope: VarScope;
  value: string;
  masked: boolean;
}

export const Vars = {
  list: (pid: string, opts: { reveal?: boolean } = {}) =>
    http.get<VarsList>(
      `/projects/${pid}/vars${opts.reveal ? "?reveal=1" : ""}`,
    ),
  get: (pid: string, name: string, opts: { reveal?: boolean } = {}) =>
    http.get<VarDetail>(
      `/projects/${pid}/vars/${encodeURIComponent(name)}${opts.reveal ? "?reveal=1" : ""}`,
    ),
  upsert: (pid: string, body: { name: string; value: string; scope?: VarScope }) =>
    http.post<{ ok: true; name: string; scope: VarScope }>(
      `/projects/${pid}/vars`,
      body,
    ),
  remove: (pid: string, name: string, scope: VarScope = "project") =>
    http.del<void>(
      `/projects/${pid}/vars/${encodeURIComponent(name)}?scope=${scope}`,
    ),
};
