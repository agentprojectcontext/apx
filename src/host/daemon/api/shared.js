// Shared helpers used by every API route module.
//
// These were inlined in api.js (monolith). They are kept dependency-free so
// any route module can `import` them without pulling in the world.
import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { appendErrorTrace, previewText } from "#core/logging.js";
import { readAgents } from "#core/apc/parser.js";
import { agentMemoryPath } from "#core/agent/memory.js";
import { apcMemoryFile } from "#core/apc/paths.js";
import { CHANNELS } from "#core/constants/channels.js";
import { isKnownSpaRoute } from "./web.js";

export const nowIso = () =>
  new Date().toISOString().replace(/\.\d{3}Z$/, "Z");

// Build a { meta, data } pagination envelope from an already-sorted array.
// Reads ?limit & ?offset from the request query. With no `limit`, returns the
// full set as a single page (data = 100% of rows) so non-paginated callers get
// the same shape — meta just reports one page covering everything.
//   meta: { total, offset, limit, pageSize, page, pageCount }
export function pageEnvelope(rows, query = {}) {
  const total = rows.length;
  const hasLimit = query.limit != null && query.limit !== "";
  const limit = hasLimit ? Math.min(Math.max(parseInt(query.limit, 10) || 0, 0), 1000) : null;
  const offset = Math.max(parseInt(query.offset, 10) || 0, 0);
  const data = limit != null ? rows.slice(offset, offset + limit) : rows.slice(offset);
  return {
    meta: {
      total,
      offset,
      limit,
      pageSize: limit != null ? limit : total,
      page: limit ? Math.floor(offset / limit) + 1 : 1,
      pageCount: limit ? Math.max(1, Math.ceil(total / limit)) : 1,
    },
    data,
  };
}

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

// Does this path look like a static asset (has a file extension)? Vite emits
// hashed, extension-bearing filenames (index-abc123.js, logo.svg, font.woff2),
// so an extension is a reliable "this is a bundle asset, not a data route"
// signal. Data routes (/skills, /projects, /p/0/tasks) have no extension.
function isStaticAssetPath(p) {
  return path.extname(p) !== "";
}

function isUnauthenticatedPath(p, method = "GET") {
  if (p === "/health") return true;
  if (p === "/admin/web-token") return true;
  for (const prefix of UNAUTHENTICATED_PREFIXES) {
    if (p === prefix.replace(/\/$/, "") || p.startsWith(prefix)) return true;
  }
  // SPA bootstrap: the admin bundle loads before it holds a bearer, so a GET
  // for a static asset or a known client-router route is served without auth —
  // the bundle then fetches /admin/web-token. Everything else, including every
  // data GET (/skills, /plugins, /embeddings, …), REQUIRES a token. This is an
  // allowlist by construction: a new data route can never silently become
  // public just because someone forgot to register its prefix (the old
  // denylist failure mode).
  if (method === "GET" && (isStaticAssetPath(p) || isKnownSpaRoute(p))) return true;
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
  return apcMemoryFile(p.path);
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
    channel: CHANNELS.API,
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
