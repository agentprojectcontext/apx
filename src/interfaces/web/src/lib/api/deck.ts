import { http } from "../http";

// Deck (companion app) client. Talks to the daemon's /deck surface.
// Shapes match src/host/daemon/api/deck.js exactly.

// ── Types ────────────────────────────────────────────────────────────────────

export type WidgetSource = "apx" | "external";

export type WidgetStatus =
  | "available"
  | "not_configured"
  | "configured"
  | "disabled";

export interface DeckWidget {
  id: string;
  title: string;
  source: WidgetSource;
  /** desktop id this widget belongs to */
  desktop: string;
  kind: string;
  status: WidgetStatus;
  /** Only present on external widgets. null = no user override yet. */
  user_enabled: boolean | null;
  /** Optional live plugin status from daemon (external widgets only). */
  daemon_status?: { enabled?: boolean; [k: string]: unknown };
}

export interface DeckDesktop {
  id: string;
  title: string;
}

export interface DeckSuggestedAction {
  id: string;
  title: string;
  risk: "safe" | "confirm";
  endpoint: string;
}

export interface DeckSection {
  name: string;
  desktops: DeckDesktop[];
  widgets: DeckWidget[];
  suggested_actions: DeckSuggestedAction[];
}

export interface DeckDaemonInfo {
  name: string;
  version: string;
  host: string;
  port: number;
  uptime_s: number;
  started_at: string;
}

export interface DeckManifest {
  status: string;
  daemon: DeckDaemonInfo;
  deck: DeckSection;
  apx: {
    active_project: { id: number; path: string; name: string } | null;
    projects: Array<{ id: number; path: string; name: string; kind: string; agents: number }>;
    plugins: Record<string, unknown>;
    endpoints: Record<string, string>;
  };
  safety: {
    direct_shell: boolean;
    arbitrary_commands: boolean;
    dangerous_actions_require_confirmation: boolean;
    allowed_actions_only: boolean;
  };
}

export interface WidgetPatchResult {
  id: string;
  enabled: boolean;
  override: { enabled: boolean };
}

// ── API Client ───────────────────────────────────────────────────────────────

export const Deck = {
  /** GET /deck/manifest — full companion manifest. */
  manifest: () => http.get<DeckManifest>("/deck/manifest"),

  /**
   * PATCH /deck/widgets/:id  { enabled: boolean }
   * Only "external" source widgets are toggleable.
   * Core (source="apx") widgets return 404.
   */
  setWidget: (id: string, body: { enabled: boolean }) =>
    http.patch<WidgetPatchResult>(`/deck/widgets/${encodeURIComponent(id)}`, body),

  /**
   * POST /deck/exec
   * Whitelisted intent-based action runner for the Deck companion.
   */
  exec: (body: {
    kind: "open_app" | "open_path" | "open_path_in" | "open_url" | "copy_clipboard";
    target?: string;
    app?: string;
    text?: string;
  }) => http.post<{ ok: boolean; kind: string; [k: string]: unknown }>("/deck/exec", body),
};
