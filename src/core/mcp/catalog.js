// What each MCP server offers, remembered from the last time its tools were
// listed. The agent cannot use a server it does not know exists, and starting
// every server to ask it would cost seconds per turn — so the per-turn context
// reads this file instead, and it fills itself as servers get used.
import crypto from "node:crypto";
import { MCP_CATALOG_PATH } from "#core/config/paths.js";
import { readJson, updateJson } from "#core/util/json-file.js";

const MAX_TOOLS = 80;

/** Same name + same endpoint = same server, whichever project registered it. */
export function mcpCatalogKey(meta) {
  const endpoint = meta?.url || [meta?.command, ...(meta?.args || [])].filter(Boolean).join(" ");
  const hash = crypto.createHash("sha1").update(String(endpoint)).digest("hex").slice(0, 10);
  return `${meta?.name || "?"}@${hash}`;
}

function firstSentence(text, max = 140) {
  const t = String(text || "").replace(/\s+/g, " ").trim();
  const cut = t.search(/[.!?](\s|$)/);
  const s = cut > 0 ? t.slice(0, cut + 1) : t;
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
}

/** Remember a server's tools. Never throws: a cache must not break a call. */
export function recordMcpTools(meta, tools) {
  if (!meta?.name || !Array.isArray(tools)) return;
  try {
    const entry = {
      name: meta.name,
      tools: tools.slice(0, MAX_TOOLS).map((t) => ({ name: t?.name, description: firstSentence(t?.description) })),
      tool_count: tools.length,
      updated_at: new Date().toISOString(),
    };
    updateJson(MCP_CATALOG_PATH, (cur) => ({ ...(cur || {}), [mcpCatalogKey(meta)]: entry }), { fallback: {} });
  } catch {
    /* best-effort */
  }
}

/** The cached entry for a server, or null when it was never listed. */
export function cachedMcpTools(meta) {
  const all = readJson(MCP_CATALOG_PATH, {}) || {};
  return all[mcpCatalogKey(meta)] || null;
}

/**
 * One line the agent can act on: name, what it is for, and what it can do.
 * `social — schedule social posts · tools: list_posts, create_post_draft, … (19)`
 */
export function describeMcpLine(meta, { maxTools = 8 } = {}) {
  const cached = cachedMcpTools(meta);
  const parts = [`\`${meta.name}\``];
  if (meta.description) parts.push(`— ${firstSentence(meta.description, 160)}`);
  if (cached?.tools?.length) {
    const names = cached.tools.slice(0, maxTools).map((t) => t.name).filter(Boolean);
    const more = cached.tool_count > names.length ? `, … (${cached.tool_count})` : "";
    parts.push(`· tools: ${names.join(", ")}${more}`);
  } else if (!meta.description) {
    parts.push("· tools not listed yet (`list_mcp_tools` shows them)");
  }
  return parts.join(" ");
}
