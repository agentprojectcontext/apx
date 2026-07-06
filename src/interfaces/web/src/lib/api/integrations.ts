import { http } from "../http";

// Where an integration record is stored. "global" targets the default project's
// store (shared across projects); "project" targets the current project. A
// project uses its own record when present, otherwise the global one.
export type IntegrationScope = "project" | "global";

// Status returned by a plugin's status endpoint. Common fields plus
// plugin-specific extras (Asana adds user/workspace, GitHub adds user_login…),
// so it carries an index signature for the generic component to read.
export interface IntegrationStatus {
  slug: string;
  status: string;
  is_enabled: boolean;
  [key: string]: unknown;
}

export interface PluginTool {
  slug: string;
  desc: string;
}

// Declarative UI descriptor (mirrors the plugin's `ui` in core). STRUCTURE ONLY
// — display text is resolved from i18n keys (integrations.<slug>.*) by the
// generic PluginConnect component. help_url/help_url_label are non-translatable.
export interface PluginConfigField {
  key: string;
  type: "password" | "text";
  placeholder?: string;
  help_url?: string;
  help_url_label?: string;
}
export interface PluginSelect {
  key: string;
  action: string;
  listKey: string;
  valueKey: string;
  labelKey: string;
}
export interface PluginUi {
  accent?: string;
  configFields: PluginConfigField[];
  select?: PluginSelect;
  connectedFields?: string[];
}

// One entry of the plugin catalog with its resolved status for this project.
export interface CatalogEntry {
  slug: string;
  name: string;
  type: string;
  description: string;
  auth: string;
  tools?: PluginTool[];
  ui?: PluginUi | null;
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
