// APX Deck bootstrap surface.
// It exposes read-only context for companion clients without making external
// services first-class APX daemon dependencies.

const CORE_WIDGETS = [
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

const EXTERNAL_WIDGETS = [
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

const DESKTOPS = [
  { id: "general", title: "Hoy" },
  { id: "project", title: "Proyecto" },
  { id: "ai", title: "IA" },
  { id: "comms", title: "Comunicaciones" },
  { id: "infra", title: "Infra" },
  { id: "work", title: "Tiempo laboral" },
  { id: "plugins", title: "Plugins" },
];

const SAFE_ACTIONS = [
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

function safePluginStatus(plugins) {
  if (!plugins || typeof plugins.status !== "function") return {};
  try {
    return plugins.status() || {};
  } catch (e) {
    return { error: e.message };
  }
}

function safeProjects(projects) {
  if (!projects || typeof projects.list !== "function") return [];
  try {
    return projects.list();
  } catch {
    return [];
  }
}

function pickActiveProject(projectList) {
  return projectList.find((project) => Number(project.id) !== 0) || projectList[0] || null;
}

function decorateExternalWidgets(pluginStatus) {
  return EXTERNAL_WIDGETS.map((widget) => {
    const status = pluginStatus[widget.id];
    if (!status) return widget;
    return {
      ...widget,
      status: status.enabled === false ? "disabled" : "available",
      daemon_status: status,
    };
  });
}

export function buildDeckManifest({ projects, plugins, version, startedAt, config }) {
  const projectList = safeProjects(projects);
  const pluginStatus = safePluginStatus(plugins);
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
      widgets: [...CORE_WIDGETS, ...decorateExternalWidgets(pluginStatus)],
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

export function register(app, ctx) {
  app.get("/deck/manifest", (_req, res) => {
    res.json(buildDeckManifest(ctx));
  });
}
