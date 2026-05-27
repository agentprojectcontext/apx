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

function decorateExternalWidgets(pluginStatus, overrides) {
  return EXTERNAL_WIDGETS.map((widget) => {
    // Three-way status:
    //   1. user explicitly disabled it → "disabled" (sticky, regardless
    //      of plugin auto-detect),
    //   2. daemon has a running plugin → "available",
    //   3. user toggled it on but no plugin backing → "configured"
    //      (Deck UI can show "no daemon support yet" hint),
    //   4. nothing → leave the static "not_configured" default.
    const override = overrides[widget.id];
    const status = pluginStatus[widget.id];
    const decorated = { ...widget };
    if (status) {
      decorated.daemon_status = status;
    }
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

export function buildDeckManifest({ projects, plugins, version, startedAt, config }) {
  const projectList = safeProjects(projects);
  const pluginStatus = safePluginStatus(plugins);
  const activeProject = pickActiveProject(projectList);
  const overrides =
    (config?.deck && typeof config.deck === "object" && config.deck.widget_overrides) || {};

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

// Whitelist of widget ids the user is allowed to override. Keeps a
// rogue client from writing arbitrary keys into the global config.
const TOGGLEABLE_WIDGETS = new Set([
  ...EXTERNAL_WIDGETS.map((w) => w.id),
  // CORE_WIDGETS are intentionally NOT in here — they're built-in APX
  // surfaces and don't make sense to disable.
]);

export function register(app, ctx) {
  app.get("/deck/manifest", (_req, res) => {
    res.json(buildDeckManifest(ctx));
  });

  // PATCH /deck/widgets/:id  body: { enabled: boolean }
  //
  // Persists the user's enable/disable choice for an external widget
  // into the global config under `deck.widget_overrides[id]`. The next
  // /deck/manifest call reflects it. No-op for unknown widget ids so
  // the deck UI can stay forward-compatible with future widgets.
  app.patch("/deck/widgets/:id", async (req, res) => {
    const id = req.params.id;
    if (!TOGGLEABLE_WIDGETS.has(id)) {
      return res.status(404).json({ error: `unknown widget: ${id}` });
    }
    const enabled = req.body?.enabled;
    if (typeof enabled !== "boolean") {
      return res.status(400).json({ error: "body.enabled must be boolean" });
    }
    // CRITICAL: we MUST read config fresh from disk before mutating.
    // The captured `ctx.config` is a snapshot from daemon startup —
    // any `apx project add` that happened since then is NOT in there.
    // Persisting that stale snapshot wipes out user-added projects
    // (which is exactly the bug we hit when we first shipped this).
    //
    // The on-disk file is the source of truth for everything except
    // the override we're about to set; we mutate ONLY the override and
    // leave everything else intact.
    try {
      const { readConfig, writeConfig } = await import("../../../core/config.js");
      const fresh = readConfig();
      fresh.deck = fresh.deck && typeof fresh.deck === "object" ? fresh.deck : {};
      fresh.deck.widget_overrides =
        fresh.deck.widget_overrides && typeof fresh.deck.widget_overrides === "object"
          ? fresh.deck.widget_overrides
          : {};
      fresh.deck.widget_overrides[id] = { enabled };
      writeConfig(fresh);

      // Also mirror the override into the live ctx.config so the next
      // /deck/manifest in this same process picks it up without a
      // re-read (mergeDefaults runs once at startup).
      if (ctx.config) {
        ctx.config.deck = ctx.config.deck || {};
        ctx.config.deck.widget_overrides = ctx.config.deck.widget_overrides || {};
        ctx.config.deck.widget_overrides[id] = { enabled };
      }
      return res.json({ id, enabled, override: fresh.deck.widget_overrides[id] });
    } catch (e) {
      return res.status(500).json({ error: e?.message || "config persistence failed" });
    }
  });

  // POST /projects/:pid/context/copy
  //
  // Reads the project's AGENTS.md + .apc/memory.md, concatenates them
  // with a small header per file, and ships the result to the
  // daemon-host clipboard via pbcopy/xclip/clip. Returns byte count so
  // the deck can toast "X bytes copiados".
  app.post("/projects/:pid/context/copy", async (req, res) => {
    const project = ctx.project ? ctx.project(req, res) : null;
    if (!project) return; // project() already 404'd
    try {
      const text = await readProjectContext(project.path);
      if (!text) return res.status(404).json({ error: "no AGENTS.md or memory.md" });
      await copyToClipboard(text);
      res.json({ ok: true, bytes: text.length });
    } catch (e) {
      res.status(500).json({ error: e?.message || String(e) });
    }
  });

  // POST /projects/:pid/notes  body: { body: "...", title?: "..." }
  //
  // Appends to .apc/notes/YYYY-MM-DD.md. Each note is a markdown block
  // with timestamp + title + body. No editing — the file is append-only
  // by design so the daemon doesn't have to manage UIDs. The deck UI
  // can later read this back via GET if we add it.
  app.post("/projects/:pid/notes", async (req, res) => {
    const project = ctx.project ? ctx.project(req, res) : null;
    if (!project) return;
    const { body, title } = req.body || {};
    if (typeof body !== "string" || !body.trim()) {
      return res.status(400).json({ error: "body required" });
    }
    try {
      const file = await appendProjectNote(project.path, {
        title: typeof title === "string" ? title.trim() : "",
        body: body.trim(),
      });
      res.json({ ok: true, file });
    } catch (e) {
      res.status(500).json({ error: e?.message || String(e) });
    }
  });

  // POST /deck/exec
  //
  // Light-touch action runner for the deck buttons. We don't want the
  // companion clients to shell out arbitrary commands — that's the
  // safety promise in /deck/manifest — so the body picks from a small
  // whitelist of "intent" verbs and the server picks the OS command.
  //
  // Body shape:
  //   { kind: "open_app", target: "claude" | "cursor" | "vscode" | "terminal" }
  //   { kind: "open_path", target: "/abs/path" | "<projectId>" }   // opens in Finder/default
  //   { kind: "open_path_in", target: "<projectId>", app: "vscode" | "cursor" | "terminal" }
  //   { kind: "open_url", target: "https://..." }
  //   { kind: "copy_clipboard", text: "..." }
  //
  // Everything routes through `open` on macOS, `xdg-open` on Linux, or
  // `start` on Windows — no shell metacharacters, all args as array.
  app.post("/deck/exec", async (req, res) => {
    const { kind, target, app: appHint, text } = req.body || {};
    if (!kind || typeof kind !== "string") {
      return res.status(400).json({ error: "kind required" });
    }
    try {
      const result = await runDeckExec({ kind, target, appHint, text, ctx });
      res.json({ ok: true, kind, ...result });
    } catch (e) {
      res.status(400).json({ error: e?.message || String(e) });
    }
  });
}

// ── /deck/exec implementation ───────────────────────────────────────
//
// All shell spawning sits behind this helper so it can be unit-tested
// in isolation. The OS abstraction is intentionally tiny: pick the
// "opener" command for the platform and pass `target` as a single arg
// (no shell). For app-launching on macOS we use `open -a <App>`.

const MAC_APPS = {
  // Whitelisted mac app names. Adding here is the only way the deck
  // can launch something — we never honour a free-form `app` string.
  claude: "Claude",
  chatgpt: "ChatGPT",
  cursor: "Cursor",
  vscode: "Visual Studio Code",
  zen: "Zen Browser",
  terminal: "Terminal",
  iterm: "iTerm",
  finder: "Finder",
};

async function runDeckExec({ kind, target, appHint, text, ctx }) {
  const { spawn } = await import("node:child_process");
  const platform = process.platform;

  const spawnDetached = (cmd, args) =>
    new Promise((resolve, reject) => {
      const child = spawn(cmd, args, { stdio: "ignore", detached: true });
      let settled = false;
      const done = (err) => {
        if (settled) return;
        settled = true;
        err ? reject(err) : resolve();
      };
      child.on("error", done);
      // Give the process a tick to fail-fast (bad binary); otherwise
      // detach and assume success.
      setTimeout(() => {
        try { child.unref(); } catch {}
        done(null);
      }, 250);
    });

  const opener = () => {
    if (platform === "darwin") return "open";
    if (platform === "win32") return "start";
    return "xdg-open";
  };

  // Resolve a project id (number or "<n>") into an absolute path via
  // the daemon's project manager. Returns null when the id is bogus.
  const projectPath = (idOrPath) => {
    if (!idOrPath) return null;
    const str = String(idOrPath);
    if (str.startsWith("/")) return str;
    if (!/^\d+$/.test(str)) return null;
    const p = ctx.projects?.get?.(parseInt(str, 10));
    return p?.path || null;
  };

  if (kind === "open_app") {
    if (platform !== "darwin") throw new Error("open_app only implemented on macOS for now");
    const appName = MAC_APPS[String(target || "").toLowerCase()];
    if (!appName) throw new Error(`unknown app: ${target}`);
    // Two-step launch:
    //   1. `open -a` ensures the app is running (no-op if already up).
    //   2. AppleScript `activate` brings it to the foreground across
    //      Spaces / Stage Manager, which `open` alone often skips when
    //      the app was already running in the background.
    // Both are best-effort; we surface success as long as the launch
    // command exited cleanly.
    await spawnDetached("open", ["-a", appName]);
    try {
      await new Promise((resolve) => {
        const child = spawn("osascript", [
          "-e",
          `tell application "${appName}" to activate`,
        ], { stdio: "ignore" });
        child.on("close", () => resolve());
        child.on("error", () => resolve());
        setTimeout(() => { try { child.kill(); } catch {} ; resolve(); }, 600);
      });
    } catch {
      // osascript missing or refused — `open -a` already ran.
    }
    return { app: appName };
  }

  if (kind === "open_path") {
    const resolved = projectPath(target);
    if (!resolved) throw new Error(`open_path: invalid target ${target}`);
    await spawnDetached(opener(), [resolved]);
    return { path: resolved };
  }

  if (kind === "open_path_in") {
    if (platform !== "darwin") throw new Error("open_path_in only implemented on macOS for now");
    const resolved = projectPath(target);
    if (!resolved) throw new Error(`open_path_in: invalid target ${target}`);
    const appName = MAC_APPS[String(appHint || "").toLowerCase()];
    if (!appName) throw new Error(`open_path_in: unknown app ${appHint}`);
    await spawnDetached("open", ["-a", appName, resolved]);
    return { app: appName, path: resolved };
  }

  if (kind === "open_url") {
    if (!target || !/^https?:\/\//i.test(String(target))) {
      throw new Error("open_url: target must be http(s) URL");
    }
    await spawnDetached(opener(), [String(target)]);
    return { url: target };
  }

  if (kind === "copy_clipboard") {
    if (typeof text !== "string") throw new Error("copy_clipboard: text required");
    // pbcopy on mac; xclip on linux; clip on windows.
    const cmd =
      platform === "darwin" ? "pbcopy" :
      platform === "win32" ? "clip" :
      "xclip";
    const args = platform === "linux" ? ["-selection", "clipboard"] : [];
    await new Promise((resolve, reject) => {
      const child = spawn(cmd, args, { stdio: ["pipe", "ignore", "ignore"] });
      child.on("error", reject);
      child.on("close", (code) => (code === 0 ? resolve() : reject(new Error(`${cmd} exited ${code}`))));
      child.stdin.end(text);
    });
    return { bytes: text.length };
  }

  throw new Error(`unknown kind: ${kind}`);
}

// ── Context + Notes helpers ────────────────────────────────────────

async function readProjectContext(projectPath) {
  const fs = await import("node:fs/promises");
  const path = await import("node:path");
  const candidates = [
    { rel: "AGENTS.md", label: "AGENTS.md" },
    { rel: ".apc/memory.md", label: ".apc/memory.md" },
  ];
  const chunks = [];
  for (const { rel, label } of candidates) {
    try {
      const abs = path.join(projectPath, rel);
      const content = await fs.readFile(abs, "utf8");
      if (content.trim()) {
        chunks.push(`# ${label}\n\n${content.trim()}\n`);
      }
    } catch {
      // missing file is fine; we just skip it.
    }
  }
  return chunks.join("\n---\n\n");
}

async function copyToClipboard(text) {
  const { spawn } = await import("node:child_process");
  const platform = process.platform;
  const cmd =
    platform === "darwin" ? "pbcopy" :
    platform === "win32" ? "clip" :
    "xclip";
  const args = platform === "linux" ? ["-selection", "clipboard"] : [];
  await new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { stdio: ["pipe", "ignore", "ignore"] });
    child.on("error", reject);
    child.on("close", (code) => (code === 0 ? resolve() : reject(new Error(`${cmd} exited ${code}`))));
    child.stdin.end(text);
  });
}

async function appendProjectNote(projectPath, { title, body }) {
  const fs = await import("node:fs/promises");
  const path = await import("node:path");
  const notesDir = path.join(projectPath, ".apc", "notes");
  await fs.mkdir(notesDir, { recursive: true });
  const today = new Date().toISOString().slice(0, 10);
  const file = path.join(notesDir, `${today}.md`);
  const ts = new Date().toISOString().replace(/\.\d{3}Z$/, "Z");
  const block = title
    ? `\n## ${title}\n_${ts}_\n\n${body}\n`
    : `\n### ${ts}\n\n${body}\n`;
  await fs.appendFile(file, block, "utf8");
  return file;
}
