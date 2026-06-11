// APX Deck bootstrap surface.
// Read-only context for companion clients (deck, desktop capsule) plus a
// safe-action runner. Domain (manifest model, project-context reader, notes
// appender) lives in core/; process orchestration (spawn child processes,
// clipboard) lives next door in host/daemon/deck-exec.js. This file is the
// HTTP adapter.
import {
  buildDeckManifest,
  TOGGLEABLE_WIDGETS,
} from "#core/deck/manifest.js";
import { readProjectContext } from "#core/apc/context-copy.js";
import { appendProjectNote } from "#core/apc/notes.js";
import { runDeckExec, copyToClipboard } from "../deck-exec.js";

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

export function register(app, ctx) {
  app.get("/deck/manifest", (_req, res) => {
    const overrides =
      (ctx.config?.deck && typeof ctx.config.deck === "object" && ctx.config.deck.widget_overrides) || {};
    res.json(
      buildDeckManifest({
        projectList: safeProjects(ctx.projects),
        pluginStatus: safePluginStatus(ctx.plugins),
        overrides,
        version: ctx.version,
        startedAt: ctx.startedAt,
        config: ctx.config,
      })
    );
  });

  // PATCH /deck/widgets/:id  body: { enabled: boolean }
  //
  // Persists the user's enable/disable choice for an external widget into the
  // global config under `deck.widget_overrides[id]`. No-op for unknown widget
  // ids so the deck UI can stay forward-compatible.
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
    // The captured `ctx.config` is a snapshot from daemon startup — any
    // `apx project add` that happened since then is NOT in there. Persisting
    // that stale snapshot wipes out user-added projects.
    try {
      const { readConfig, writeConfig } = await import("#core/config/index.js");
      const fresh = readConfig();
      fresh.deck = fresh.deck && typeof fresh.deck === "object" ? fresh.deck : {};
      fresh.deck.widget_overrides =
        fresh.deck.widget_overrides && typeof fresh.deck.widget_overrides === "object"
          ? fresh.deck.widget_overrides
          : {};
      fresh.deck.widget_overrides[id] = { enabled };
      writeConfig(fresh);

      // Mirror into the live ctx.config so the next /deck/manifest in this
      // same process picks it up without a re-read.
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
  // Reads the project's AGENTS.md + .apc/memory.md, concatenates them with a
  // small header per file, and ships the result to the daemon-host clipboard.
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
  // Light-touch action runner for the deck buttons. Companion clients can't
  // shell out arbitrary commands — body picks from a whitelist of "intent"
  // verbs and the server picks the OS command. See deck-exec.js for the kinds.
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
