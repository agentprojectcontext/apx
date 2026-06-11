// APX Deck manifest — the data model the companion clients (deck, desktop
// capsule) read on boot. Pure data + decoration; no HTTP or filesystem.
// host/daemon/api/deck.js wraps this for the /deck/manifest endpoint.

export const CORE_WIDGETS = [
  {
    id: "apx-current-project",
    title: "Proyecto actual",
    source: "apx",
    desktop: "project",
    kind: "context",
    status: "available",
  },
  {
    id: "apx-voice",
    title: "Voz APX",
    source: "apx",
    desktop: "general",
    kind: "voice",
    status: "available",
  },
  {
    id: "apx-agents",
    title: "Agentes APX",
    source: "apx",
    desktop: "ai",
    kind: "agents",
    status: "available",
  },
  {
    id: "apx-notes",
    title: "Notas APX",
    source: "apx",
    desktop: "project",
    kind: "capture",
    status: "available",
  },
];

export const EXTERNAL_WIDGETS = [
  ["docker", "Docker", "infra"],
  ["dokploy", "Dokploy", "infra"],
  ["factorial", "Factorial", "work"],
  ["telegram", "Telegram", "comms"],
  ["gmail", "Gmail", "comms"],
  ["outlook", "Outlook", "comms"],
  ["teams", "Teams", "comms"],
  ["whatsapp", "WhatsApp", "comms"],
  ["zen", "Zen Browser", "ai"],
  ["claude", "Claude", "ai"],
  ["chatgpt", "ChatGPT", "ai"],
  ["cursor", "Cursor", "ai"],
  ["codex", "Codex", "ai"],
].map(([id, title, desktop]) => ({
  id,
  title,
  source: "external",
  desktop,
  kind: "plugin",
  status: "not_configured",
}));

export const DESKTOPS = [
  { id: "general", title: "Hoy" },
  { id: "project", title: "Proyecto" },
  { id: "ai", title: "IA" },
  { id: "comms", title: "Comunicaciones" },
  { id: "infra", title: "Infra" },
  { id: "work", title: "Tiempo laboral" },
  { id: "plugins", title: "Plugins" },
];

export const SAFE_ACTIONS = [
  {
    id: "apx.copy_context",
    title: "Copiar contexto APX",
    risk: "safe",
    endpoint: "/projects/:pid/agents",
  },
  {
    id: "apx.voice_turn",
    title: "Hablar con APX",
    risk: "safe",
    endpoint: "/voice/turn",
  },
  {
    id: "apx.super_agent",
    title: "Pedir acción a APX",
    risk: "confirm",
    endpoint: "/projects/:pid/super-agent/chat",
  },
];

// Widget ids the user is allowed to override. Keeps a rogue client from
// writing arbitrary keys into the global config under deck.widget_overrides.
// CORE_WIDGETS are intentionally NOT in here — they're built-in APX surfaces
// and don't make sense to disable.
export const TOGGLEABLE_WIDGETS = new Set(EXTERNAL_WIDGETS.map((w) => w.id));

function pickActiveProject(projectList) {
  return projectList.find((project) => Number(project.id) !== 0) || projectList[0] || null;
}

/**
 * Apply runtime status + user overrides to the static EXTERNAL_WIDGETS list.
 *
 *   1. user explicitly disabled it → "disabled" (sticky, regardless of plugin
 *      auto-detect)
 *   2. daemon has a running plugin → "available"
 *   3. user toggled it on but no plugin backing → "configured"
 *   4. nothing → leave the static "not_configured" default
 */
export function decorateExternalWidgets(pluginStatus = {}, overrides = {}) {
  return EXTERNAL_WIDGETS.map((widget) => {
    const override = overrides[widget.id];
    const status = pluginStatus[widget.id];
    const decorated = { ...widget };
    if (status) decorated.daemon_status = status;
    if (override?.enabled === false) {
      decorated.status = "disabled";
    } else if (status) {
      decorated.status = status.enabled === false ? "disabled" : "available";
    } else if (override?.enabled === true) {
      decorated.status = "configured";
    }
    // Always echo the user-toggle so the app can render the switch
    // independently of the running/available bit.
    decorated.user_enabled = override?.enabled ?? null;
    return decorated;
  });
}

/**
 * Build the full /deck/manifest response body.
 *
 * Inputs are *resolved* runtime values, not the live managers — caller is
 * responsible for catching errors in projects.list()/plugins.status() and
 * passing the resulting arrays/maps in (or empty defaults).
 */
export function buildDeckManifest({
  projectList = [],
  pluginStatus = {},
  overrides = {},
  version,
  startedAt,
  config,
}) {
  const activeProject = pickActiveProject(projectList);
  return {
    status: "ok",
    daemon: {
      name: "apx",
      version,
      host: config?.host || "127.0.0.1",
      port: config?.port || 7430,
      uptime_s: Math.round((Date.now() - startedAt) / 1000),
      started_at: new Date(startedAt).toISOString(),
    },
    deck: {
      name: "apx-deck",
      desktops: DESKTOPS,
      widgets: [...CORE_WIDGETS, ...decorateExternalWidgets(pluginStatus, overrides)],
      suggested_actions: SAFE_ACTIONS,
    },
    apx: {
      active_project: activeProject,
      projects: projectList,
      plugins: pluginStatus,
      endpoints: {
        health: "/health",
        projects: "/projects",
        plugins: "/plugins",
        voice_turn: "/voice/turn",
        transcribe_chunk: "/transcribe/chunk",
        super_agent_chat: "/projects/:pid/super-agent/chat",
        super_agent_stream: "/projects/:pid/super-agent/chat/stream",
      },
    },
    safety: {
      direct_shell: false,
      arbitrary_commands: false,
      dangerous_actions_require_confirmation: true,
      allowed_actions_only: true,
    },
  };
}
