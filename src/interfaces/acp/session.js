// ACP session plumbing — daemon HTTP client, project resolution for a
// session's cwd, and the small mapping helpers between APX daemon stream
// events and ACP wire shapes.
//
// The daemon client is deliberately NOT the CLI's http.js: that module pins
// its base URL to env vars at import time, while tests (and future embeddings)
// need a per-instance {baseUrl, token}. The NDJSON reader mirrors
// src/interfaces/cli/http.js streamRequest so both surfaces parse the daemon
// stream identically.

import path from "node:path";
import { findApfRoot } from "#core/apc/parser.js";

/**
 * Minimal daemon HTTP client bound to an injected base URL + token.
 * `token` may be a string or a () => string (re-read per request so a daemon
 * restart with a rotated token keeps working mid-session).
 */
export function createDaemonClient({ baseUrl, token = "", ensureReady = null }) {
  const authHeaders = () => {
    const t = typeof token === "function" ? token() : token;
    return t ? { authorization: `Bearer ${t}` } : {};
  };

  async function request(method, p, body) {
    if (ensureReady) await ensureReady();
    const res = await fetch(`${baseUrl}${p}`, {
      method,
      headers: {
        ...(body ? { "content-type": "application/json" } : {}),
        ...authHeaders(),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    const text = await res.text();
    let json = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      /* non-JSON body — handled below */
    }
    if (!res.ok) throw new Error(json?.error || `${method} ${p} → ${res.status}`);
    return json;
  }

  /**
   * POST to an NDJSON stream endpoint. Awaits `onEvent` per event so a
   * confirmation round-trip naturally back-pressures the stream. Returns the
   * `result` of the `{type:"final"}` event, or null when aborted early.
   */
  async function streamPost(p, body, onEvent, { signal } = {}) {
    if (ensureReady) await ensureReady();
    const res = await fetch(`${baseUrl}${p}`, {
      method: "POST",
      headers: { "content-type": "application/json", ...authHeaders() },
      body: JSON.stringify(body),
      signal,
    });
    if (!res.ok) {
      const text = await res.text();
      let json = null;
      try {
        json = text ? JSON.parse(text) : null;
      } catch {}
      throw new Error(json?.error || `POST ${p} → ${res.status}`);
    }
    if (!res.body?.getReader) {
      throw new Error("streaming response is not supported by this Node.js runtime");
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let finalResult = null;

    if (signal) {
      signal.addEventListener("abort", () => reader.cancel().catch(() => {}), { once: true });
    }

    const handleLine = async (line) => {
      if (!line.trim()) return;
      const event = JSON.parse(line);
      if (event.type === "final") finalResult = event.result;
      if (event.type === "error") throw new Error(event.error || "stream error");
      await onEvent?.(event);
    };

    while (true) {
      let chunk;
      try {
        chunk = await reader.read();
      } catch {
        break; // abort/cancel — treat as clean end, caller checks its own flag
      }
      if (chunk.done) break;
      buffer += decoder.decode(chunk.value, { stream: true });
      const lines = buffer.split(/\r?\n/);
      buffer = lines.pop() || "";
      for (const line of lines) await handleLine(line);
    }

    buffer += decoder.decode();
    if (buffer.trim()) {
      try {
        await handleLine(buffer);
      } catch {}
    }

    return finalResult;
  }

  return {
    baseUrl,
    get: (p) => request("GET", p),
    post: (p, body) => request("POST", p, body),
    streamPost,
  };
}

/**
 * Resolve the APC project for an ACP session's cwd — same contract as the
 * mcp-server surface: walk up to the .apc root, match a registered daemon
 * project by path, register it when unknown.
 */
export async function resolveProjectForCwd(client, cwd) {
  const root = findApfRoot(cwd || process.cwd());
  if (!root) {
    throw new Error(
      `No APC project found at or above: ${cwd}. Run \`apx init\` in the workspace first.`
    );
  }
  const projects = await client.get("/projects");
  const match = (projects || []).find(
    (p) => path.resolve(p.path) === path.resolve(root)
  );
  if (match) return match;
  return client.post("/projects", { path: root });
}

/** Flatten an ACP prompt (ContentBlock[]) into the text the daemon expects. */
export function extractPromptText(blocks) {
  if (typeof blocks === "string") return blocks;
  if (!Array.isArray(blocks)) return "";
  const parts = [];
  for (const block of blocks) {
    if (!block || typeof block !== "object") continue;
    if (block.type === "text" && typeof block.text === "string") {
      parts.push(block.text);
    } else if (block.type === "resource_link" && block.uri) {
      // Baseline capability: resource links arrive as URIs; surface them to
      // the model as plain references (we don't fetch on the agent side).
      parts.push(String(block.uri));
    }
  }
  return parts.join("\n").trim();
}

// Best-effort mapping from APX tool names (snake_case verbs) to ACP ToolKind.
const KIND_RULES = [
  [/^(search|find)_/, "search"],
  [/^(read|list|get|show)_/, "read"],
  [/^(edit|write|update|set|create|add|remember|import)_?/, "edit"],
  [/^(delete|remove)_/, "delete"],
  [/(shell|exec|run|call)/, "execute"],
  [/(fetch|http|web|download)/, "fetch"],
];

export function toolKindFor(toolName) {
  const name = String(toolName || "").toLowerCase();
  for (const [re, kind] of KIND_RULES) {
    if (re.test(name)) return kind;
  }
  return "other";
}

/** Compact text summary of a tool result for tool_call_update content. */
export function summarizeToolResult(result, max = 2000) {
  let text;
  if (result == null) text = "";
  else if (typeof result === "string") text = result;
  else {
    try {
      text = JSON.stringify(result, null, 2);
    } catch {
      text = String(result);
    }
  }
  return text.length > max ? text.slice(0, max - 1) + "…" : text;
}

let sessionCounter = 0;

/** Per-connection session state. History feeds `previousMessages` so multi-turn
 * ACP sessions keep context without any daemon-side session storage. */
export function createSession({ id, project, cwd }) {
  sessionCounter += 1;
  return {
    id,
    project,
    cwd,
    history: [], // [{role: "user"|"assistant", content: string}]
    activeTurn: null, // { abort: AbortController, cancelled: boolean }
    seq: sessionCounter,
  };
}
