// Shared helpers used by every API route module.
//
// These were inlined in api.js (monolith). They are kept dependency-free so
// any route module can `import` them without pulling in the world.
import path from "node:path";
import { randomUUID } from "node:crypto";
import { appendErrorTrace, previewText } from "#core/logging.js";
import { readAgents } from "#core/apc/parser.js";
import { agentMemoryPath } from "#core/agent/memory.js";
import { apcMemoryFile } from "#core/apc/paths.js";
import { CHANNELS } from "#core/constants/channels.js";
import { slugifyName } from "#core/stores/organization.js";
import { apiPath, isApiPath } from "./prefix.js";

export const nowIso = () =>
  new Date().toISOString().replace(/\.\d{3}Z$/, "Z");

// Build a { meta, data } pagination envelope from an already-sorted array.
// Reads ?limit & ?offset from the request query. With no `limit`, returns the
// full set as a single page (data = 100% of rows) so non-paginated callers get
// the same shape — meta just reports one page covering everything.
//   meta: { total, offset, limit, pageSize, page, pageCount }
/**
 * Wrap an async route handler so a rejected promise becomes a 500 instead of
 * an unhandled rejection.
 *
 * Express 4 does not await handlers: if one throws asynchronously, the error
 * never reaches the error middleware, the request hangs, and on Node >= 15 the
 * unhandled rejection takes the whole daemon down. Several routes awaited work
 * with no try/catch, so a single failing preview or engine probe could kill a
 * process serving the SPA, Telegram polling and voice at the same time.
 *
 *   api.get("/things", asyncRoute(async (req, res) => { ... }))
 */
// An a2a "group chat" is an exchange BETWEEN two agents, so it belongs to
// neither of them and has no agents/<slug>/conversations/ directory. The inbox
// still has to list it beside the individual chats, so it hands out a synthetic
// slug — `a2a:<pairId>` — and every surface (web, /mobile, inbox) opens a row
// through the per-agent endpoints with it.
//
// The prefix is defined ONCE, here, because it is a contract between the route
// that mints it (api/inbox.js) and the routes that must recognise it. It is a
// display/read handle: threads can be read through it, never written to.
export const A2A_SLUG_PREFIX = "a2a:";
// Same idea for group rooms: the inbox mints `group:<id>` so a group thread has
// a stable handle in the same lists as individual and a2a rows.
export const GROUP_SLUG_PREFIX = "group:";

/** The pair id inside a synthetic a2a slug, or null for an ordinary agent. */
export function a2aSlugThreadId(slug) {
  const s = String(slug || "");
  return s.startsWith(A2A_SLUG_PREFIX) ? s.slice(A2A_SLUG_PREFIX.length) : null;
}

/**
 * Refuse a write aimed at an a2a slug, with a reason the caller can act on.
 * Returns true when it answered — "agent not found" was actively misleading
 * here: the agent is not missing, the target is not an agent at all.
 */
export function rejectA2AWrite(req, res, what) {
  if (a2aSlugThreadId(req.params?.slug) === null) return false;
  res.status(400).json({
    error: `a2a threads cannot be ${what} — they are a record of two agents talking, derived from the message ledger. Address one of the participants instead.`,
  });
  return true;
}

export function asyncRoute(handler) {
  return (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next);
}

/**
 * Terminal error middleware. Mounted after every route; turns anything that
 * reached `next(err)` into a JSON `{ error }` with a real status code.
 */
export function errorMiddleware(log = () => {}) {
  // eslint-disable-next-line no-unused-vars -- Express detects the 4-arg shape.
  return (err, req, res, _next) => {
    const status = Number(err?.status || err?.statusCode) || 500;
    const message = err?.message || "internal error";
    log(`error: ${req.method} ${req.originalUrl} → ${status}: ${err?.stack || message}`);
    try {
      appendErrorTrace({
        where: `${req.method} ${req.originalUrl}`,
        error: message,
        trace_id: req.apxTraceId,
      });
    } catch { /* tracing must never mask the original error */ }
    if (res.headersSent) return;
    res.status(status).json({ error: message });
  };
}

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

// One log line per super-agent HTTP request: caller, method, path, status and
// how long the turn took.
//
// Why this exists: the super-agent endpoints are what phone automations
// (Tasker), the Deck app and `apx exec` all POST into, and nothing recorded
// that a request had even *arrived*. A client sending a stale token, the wrong
// HTTP method or the wrong URL produced exactly the same silence as a daemon
// that was down — which is how one Tasker misconfiguration (HEAD instead of
// POST) survived an hour of debugging against the phone instead of being read
// off a log line.
//
// Mounted ABOVE the auth wall on purpose. A bad token is rejected before the
// /api router ever runs, so a router-level middleware would miss the 401 —
// the single most useful line here.
//
// Metadata only: never the body or the headers, both of which carry the bearer
// token and the message text.
export function buildRequestLogger({ log, match }) {
  return function requestLogger(req, res, next) {
    if (!match(req.path)) return next();

    const startedAt = process.hrtime.bigint();
    // Behind `tailscale serve` the socket peer is always loopback and the real
    // tailnet caller is in X-Forwarded-For, so prefer that when present.
    const forwarded = (req.get("x-forwarded-for") || "").split(",")[0].trim();
    const caller = forwarded || req.ip || req.socket?.remoteAddress || "unknown";
    // Snapshot the path NOW: express rewrites req.url (and with it req.path) to
    // be relative once the request enters the router mounted at /api, so a path
    // read inside the finish callback would lose the prefix for routes that got
    // that far — and keep it for the 401s that never did. Logging both shapes
    // for the same URL makes the lines impossible to grep as one.
    const reqPath = req.path;
    // The caller's own label for the surface it is (`channel` in the body:
    // "whatsapp" for the Tasker bridge, "web" for the panel, absent for a bare
    // API call). Turns on any channel but web/web_sidebar are deliberately not
    // persisted to the ledger — see logWebTurn — so without this the log is the
    // ONLY record that an automation fired at all, and two automations on the
    // same device are indistinguishable by IP. Just the channel name: the body
    // also carries the message text, which stays out of the log.
    const channel = typeof req.body?.channel === "string"
      ? req.body.channel.slice(0, 32)
      : "";

    let done = false;
    const finish = (outcome) => {
      if (done) return;
      done = true;
      const ms = Math.round(Number(process.hrtime.bigint() - startedAt) / 1e6);
      log(
        `request ${req.method} ${reqPath} from ${caller}` +
        `${channel ? ` channel=${channel}` : ""} → ${outcome} ${ms}ms` +
        ` [${req.apxTraceId}]`
      );
    };

    // "finish" = a response was written. "close" without "finish" = the client
    // hung up first (a Tasker HTTP timeout looks exactly like this), which is
    // worth a distinct outcome rather than no line at all.
    res.on("finish", () => finish(String(res.statusCode)));
    res.on("close", () => finish("client-aborted"));
    next();
  };
}

// Paths that bypass auth: /api/health for liveness probes, /api/pair/* so a
// fresh client can bootstrap a token without already having one, and
// /api/admin/web-token so the local same-origin admin panel can self-bootstrap.
// /api/pair/init and /api/admin/web-token both enforce localhost-only checks of
// their own — the auth middleware just gets out of their way.
//
// These are full paths: the middleware runs at app level (before the /api
// router), so req.path is the complete URL path.
const UNAUTHENTICATED_PREFIXES = [
  apiPath("/health"),
  apiPath("/pair/"),
  apiPath("/admin/web-token"),
  // OAuth landing: Google's browser redirect arrives with no bearer token. The
  // route defends itself with a signed `state` instead (see api/integrations.js).
  apiPath("/integrations/oauth/callback"),
];

function isUnauthenticatedPath(p, method = "GET") {
  for (const prefix of UNAUTHENTICATED_PREFIXES) {
    if (p === prefix.replace(/\/$/, "") || p.startsWith(prefix)) return true;
  }
  // Everything under /api needs a token, full stop. This is the whole auth
  // wall: since the /api cutover there is no data route outside that prefix,
  // and a path is on one side of the seam or the other.
  if (isApiPath(p)) return false;
  // SPA bootstrap: the admin bundle loads before it holds a bearer, so a GET
  // outside /api is served without auth — the bundle then fetches
  // /api/admin/web-token. Out here there is nothing BUT the panel: a hashed
  // bundle asset (index-abc123.js, logo.svg) or a client-router path, and both
  // resolve to the same public index.html shell.
  //
  // Including paths the router does NOT know. That is deliberate: an unknown
  // route is exactly the one that must reach the SPA fallback (api/web.js),
  // which serves the shell with a 404 so React Router can draw the styled
  // NotFound screen. While this was gated on isKnownSpaRoute, a typo'd URL got
  // a bare 401 JSON body instead — and the old justification ("an unknown
  // extension-less GET might be a data route") died with the cutover above.
  return method === "GET";
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
    "Name",
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
    "Emoji",
    "Icon",
    "Autonomy",
  ]);
  const extra = {};
  for (const [k, v] of Object.entries(f)) {
    if (!reserved.has(k)) extra[k] = v;
  }
  return {
    slug: a.slug,
    // Human-readable display name. The slug stays the immutable identity
    // (filename, links, delegation); Name is what surfaces in the UI.
    name: f.Name || null,
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
    // Canonical slug, so `Growth` and `growth` group as one area in the team
    // view even when the file on disk still has the display name.
    area: f.Area ? (slugifyName(f.Area) || f.Area) : null,
    // Display emoji (avatar) + autonomy (permission mode: total/automatico/
    // permiso). Definitional, kept in APC frontmatter so they travel with the
    // project and stay diffable.
    emoji: f.Emoji || null,
    // Blob-preset key for the animated avatar (see web blobPresets). Definitional,
    // kept in APC frontmatter alongside Emoji so it travels with the project.
    icon: f.Icon || null,
    autonomy: f.Autonomy || null,
    skills: Array.isArray(f.Skills) ? f.Skills : [],
    tools: Array.isArray(f.Tools) ? f.Tools : [],
    extra,
  };
}
