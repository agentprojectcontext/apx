// Shared helpers used by every API route module.
//
// These were inlined in api.js (monolith). They are kept dependency-free so
// any route module can `import` them without pulling in the world.
import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { appendErrorTrace, previewText } from "../../../core/logging.js";
import { readAgents } from "../../../core/apc/parser.js";
import { agentMemoryPath } from "../../../core/agent/memory.js";

export const nowIso = () =>
  new Date().toISOString().replace(/\.\d{3}Z$/, "Z");

// Trace id middleware — populates req.apxTraceId and echoes it on the response.
export function traceIdMiddleware(req, res, next) {
  req.apxTraceId = req.get("x-apx-trace-id") || randomUUID();
  res.setHeader("x-apx-trace-id", req.apxTraceId);
  next();
}

// Paths that bypass auth: /health for liveness probes, /pair/* so a fresh
// client can bootstrap a token without already having one, and
// /admin/web-token so the local same-origin admin panel can self-bootstrap.
// /pair/init and /admin/web-token both enforce localhost-only checks of
// their own — the auth middleware just gets out of their way.
const UNAUTHENTICATED_PREFIXES = ["/health", "/pair/", "/admin/web-token"];
// API prefixes that MUST stay authenticated. Anything not in this list,
// requested with GET, is treated as a static SPA asset (HTML/CSS/JS/font)
// or a client-router path and served without auth — the bundle itself
// fetches /admin/web-token to obtain a bearer for the subsequent API
// calls. This is safe because all data-bearing routes start with one of
// the API prefixes below.
const API_PREFIXES = [
  "/health", "/admin", "/projects", "/telegram", "/engines", "/runtimes",
  "/messages", "/sessions", "/tools", "/mcp", "/voice", "/tts", "/desktop", "/overlay",
  "/transcribe", "/run", "/files", "/memory", "/env", "/pair", "/deck",
  "/super-agent", "/identity", "/agents", "/tasks",
];
function isApiPath(p) {
  for (const prefix of API_PREFIXES) {
    if (p === prefix || p.startsWith(prefix + "/")) return true;
  }
  return false;
}
function isUnauthenticatedPath(p, method = "GET") {
  if (p === "/health") return true;
  if (p === "/admin/web-token") return true;
  for (const prefix of UNAUTHENTICATED_PREFIXES) {
    if (p === prefix.replace(/\/$/, "") || p.startsWith(prefix)) return true;
  }
  // GET requests that don't hit an API prefix are SPA assets / client-router
  // paths; let them through so the admin bundle can load before it has a
  // bearer.
  if (method === "GET" && !isApiPath(p)) return true;
  return false;
}

// Bearer-token auth.
//
// Accepts either:
//   - a string (legacy: single master token), or
//   - a tokenStore { has(token), touch?(token) } from token-store.js
//
// The tokenStore form lets multiple paired clients each carry their own
// token. The middleware does an O(1) Set check and best-effort updates
// last_seen.
export function buildAuthMiddleware(tokenOrStore) {
  const isStore = tokenOrStore && typeof tokenOrStore === "object" && typeof tokenOrStore.has === "function";
  return (req, res, next) => {
    if (isUnauthenticatedPath(req.path, req.method)) return next();
    const auth = req.get("authorization") || "";
    const provided = auth.startsWith("Bearer ") ? auth.slice(7) : "";
    const ok = isStore ? tokenOrStore.has(provided) : provided === tokenOrStore;
    if (!ok) return res.status(401).json({ error: "unauthorized" });
    if (isStore && typeof tokenOrStore.touch === "function") {
      try { tokenOrStore.touch(provided); } catch {}
    }
    next();
  };
}

// Resolve a project by `:pid` and 404 if missing.
export function makeProjectResolver(projects) {
  return function project(req, res) {
    const p = projects.get(req.params.pid);
    if (!p) {
      res.status(404).json({ error: "project not found" });
      return null;
    }
    return p;
  };
}

// Resolve a "top-level" project for routes that don't carry :pid:
// /memory, /files, /mcp, /mcp/run.
// Strategy: explicit ?project= wins; otherwise pick the first non-default
// project; if none, fall back to id=0 (super-agent default workspace).
export function makeTopProjectResolver(projects) {
  return function resolveTopProject(query) {
    const ref = query?.project;
    if (ref !== undefined && ref !== null) {
      const all = projects.list();
      const r = String(ref);
      return projects.get(
        all.find((p) => String(p.id) === r || p.path === path.resolve(r))?.id
      );
    }
    const all = projects.list().filter((p) => p.id !== 0);
    return all.length ? projects.get(all[0].id) : projects.get(0);
  };
}

// Pick the memory.md to use when /memory is called without an agent ref.
// Prefer the first agent's runtime-local memory; else project-level .apc/memory.md.
export function resolveMemoryPath(p) {
  const firstAgent = readAgents(p.path)[0];
  if (firstAgent) return agentMemoryPath(p, firstAgent.slug);
  return path.join(p.path, ".apc", "memory.md");
}

// Channel context passed to the super-agent loop. `api` is the default when
// the caller didn't explicitly set channel/channelMeta.
export function resolveSuperAgentContext(req, project) {
  const { channel, channelMeta, contextNote } = req.body || {};
  if (channel) {
    const meta =
      channelMeta && typeof channelMeta === "object" ? channelMeta : {};
    // Always anchor the meta to the resolved project so the super-agent prompt
    // can load this project's AGENTS.md (buildProjectAgentsBlock). Caller-set
    // values win.
    return {
      channel,
      channelMeta: {
        projectId: String(project.id),
        projectName: project.name,
        projectPath: project.path,
        ...meta,
      },
      contextNote: contextNote || "",
    };
  }
  return {
    channel: "api",
    channelMeta: {
      projectId: String(project.id),
      projectName: project.name,
      projectPath: project.path,
    },
    contextNote: contextNote || "",
  };
}

// Persist an error trace from a super-agent endpoint into ~/.apx/logs.
export function appendSuperAgentErrorTrace(req, error, details = {}) {
  appendErrorTrace({
    trace_id: req.apxTraceId,
    surface: "daemon_api",
    route: `${req.method} ${req.route?.path || req.path}`,
    project_id: req.params?.pid || null,
    channel: details.channel || null,
    model: details.model || null,
    stream: !!details.stream,
    prompt_preview: previewText(details.prompt),
    previous_messages: Array.isArray(details.previousMessages)
      ? details.previousMessages.length
      : 0,
    error: {
      message: error?.message || String(error),
      stack: error?.stack || null,
    },
  });
}

// Shape an agent's parsed fields into the API response shape.
export function agentToResponse(a) {
  if (!a) return null;
  const f = a.fields || {};
  const reserved = new Set([
    "Role",
    "Model",
    "Language",
    "Description",
    "Skills",
    "Tools",
    "Master",
    "Primary",
    "Parent",
    "Type",
    "Area",
  ]);
  const extra = {};
  for (const [k, v] of Object.entries(f)) {
    if (!reserved.has(k)) extra[k] = v;
  }
  return {
    slug: a.slug,
    role: f.Role || null,
    model: f.Model || null,
    language: f.Language || null,
    description: f.Description || null,
    is_master: String(f.Master || f.Primary || "").toLowerCase() === "true",
    // Orchestrator → subagent link. Lives in APC (AGENT.md frontmatter), so it
    // travels with the project and is diffable. Runtime state stays in ~/.apx.
    parent: f.Parent || null,
    // Typology (specialist/assistant/orchestrator/worker/monitor) + area. Both
    // definitional, kept in APC frontmatter.
    type: f.Type || null,
    area: f.Area || null,
    skills: Array.isArray(f.Skills) ? f.Skills : [],
    tools: Array.isArray(f.Tools) ? f.Tools : [],
    extra,
  };
}
