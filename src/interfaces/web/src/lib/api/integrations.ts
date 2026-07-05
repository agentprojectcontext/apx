import { http } from "../http";

// Where an integration record is stored. "global" targets the default project's
// store (shared across projects); "project" targets the current project. A
// project uses its own record when present, otherwise the global one.
export type IntegrationScope = "project" | "global";

// Status returned by a plugin's status endpoint. Common fields plus
// plugin-specific extras (Asana adds user/workspace metadata).
export interface IntegrationStatus {
  slug: string;
  status: string;
  is_enabled: boolean;
  user_name?: string | null;
  user_email?: string | null;
  workspace_gid?: string | null;
  workspace_name?: string | null;
}

export interface PluginTool {
  slug: string;
  desc: string;
}

// One entry of the plugin catalog with its resolved status for this project.
export interface CatalogEntry {
  slug: string;
  name: string;
  type: string;
  description: string;
  auth: string;
  tools?: PluginTool[];
  coming_soon: boolean;
  status: IntegrationStatus;
  resolved_scope: IntegrationScope | null;
}

// A stored integration record (secrets redacted; `<key>_set` booleans instead).
export interface IntegrationRecord {
  slug: string;
  name: string;
  type: string;
  description: string;
  source: string;
  status: string;
  is_enabled: boolean;
  config: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export interface AsanaConfigureBody {
  personalAccessToken?: string;
  workspaceGid?: string;
}

export interface AsanaValidateResult {
  ok: boolean;
  user_name?: string | null;
  user_email?: string | null;
  workspace_gid?: string | null;
  workspace_name?: string | null;
  error?: string;
}

export interface AsanaWorkspaces {
  workspaces: { gid: string; name: string }[];
}

const q = (scope: IntegrationScope) => `?scope=${scope}`;

export const Integrations = {
  catalog: (pid: string) =>
    http.get<CatalogEntry[]>(`/projects/${pid}/integrations/catalog`),

  list: (pid: string, scope: IntegrationScope = "project") =>
    http.get<IntegrationRecord[]>(`/projects/${pid}/integrations${q(scope)}`),

  status: (pid: string, slug: string, scope: IntegrationScope = "project") =>
    http.get<IntegrationStatus>(`/projects/${pid}/integrations/${slug}${q(scope)}`),

  configure: (pid: string, slug: string, scope: IntegrationScope, body: Record<string, unknown>) =>
    http.post<IntegrationRecord>(`/projects/${pid}/integrations/${slug}/configure${q(scope)}`, body),

  validate: (pid: string, slug: string, scope: IntegrationScope = "project") =>
    http.post<AsanaValidateResult>(`/projects/${pid}/integrations/${slug}/validate${q(scope)}`, {}),

  deactivate: (pid: string, slug: string, scope: IntegrationScope = "project") =>
    http.post<IntegrationStatus>(`/projects/${pid}/integrations/${slug}/deactivate${q(scope)}`, {}),

  action: <T>(pid: string, slug: string, action: string, scope: IntegrationScope = "project") =>
    http.post<T>(`/projects/${pid}/integrations/${slug}/action/${action}${q(scope)}`, {}),

  remove: (pid: string, slug: string, scope: IntegrationScope = "project") =>
    http.del<void>(`/projects/${pid}/integrations/${slug}${q(scope)}`),

  // ── Asana convenience wrappers ──────────────────────────────────────────────
  asanaConfigure: (pid: string, scope: IntegrationScope, body: AsanaConfigureBody) =>
    Integrations.configure(pid, "asana", scope, {
      personal_access_token: body.personalAccessToken,
      workspace_gid: body.workspaceGid,
    }),
  asanaValidate: (pid: string, scope: IntegrationScope) => Integrations.validate(pid, "asana", scope),
  asanaWorkspaces: (pid: string, scope: IntegrationScope) =>
    Integrations.action<AsanaWorkspaces>(pid, "asana", "workspaces", scope),
};
