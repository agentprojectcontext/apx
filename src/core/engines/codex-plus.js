// Codex Plus engine — ChatGPT / Codex subscription as an APX chat engine.
//
// Not the coding CLI (`codex exec`). Talks to
// chatgpt.com/backend-api/codex/responses with APX-owned OAuth
// (~/.apx/auth/chatgpt-codex.json), falling back to a read-only borrow of
// ~/.codex/auth.json. Prefer `apx auth chatgpt-codex login`.

import { streamSseDataEvents } from "./_streaming.js";
import {
  CODEX_PLUS_BASE_URL,
  codexPlusHeaders,
  loadCodexPlusCreds,
  loadCodexPlusCredsSync,
  readCodexModelsCache,
  resolveCodexAuthPath,
} from "./codex-plus-auth.js";

function textOf(content) {
  if (content == null) return "";
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((p) => {
        if (typeof p === "string") return p;
        if (p && typeof p === "object") return p.text || p.input_text || "";
        return "";
      })
      .filter(Boolean)
      .join("\n");
  }
  return String(content);
}

/** OpenAI chat tools → Responses function tools. */
function toResponsesTools(tools) {
  if (!Array.isArray(tools) || tools.length === 0) return null;
  const out = [];
  for (const t of tools) {
    const fn = t?.function || t;
    const name = fn?.name;
    if (!name) continue;
    out.push({
      type: "function",
      name,
      description: fn.description || "",
      parameters: fn.parameters || { type: "object", properties: {} },
    });
  }
  return out.length ? out : null;
}

/**
 * Convert APX/OpenAI chat messages into Responses `input` items.
 * System prompt is pulled out as `instructions` by the caller.
 */
function toResponsesInput(messages) {
  const input = [];
  for (const m of messages) {
    if (!m || !m.role) continue;
    if (m.role === "system") continue; // handled as instructions

    if (m.role === "tool") {
      const callId = m.tool_call_id || m.id;
      if (!callId) continue;
      input.push({
        type: "function_call_output",
        call_id: callId,
        output: textOf(m.content),
      });
      continue;
    }

    if (m.role === "assistant" && Array.isArray(m.tool_calls) && m.tool_calls.length) {
      // Prior assistant tool round: emit function_call items (and optional text).
      const prose = textOf(m.content);
      if (prose) {
        input.push({
          type: "message",
          role: "assistant",
          content: [{ type: "output_text", text: prose }],
        });
      }
      for (const tc of m.tool_calls) {
        const callId = tc.id || tc.call_id;
        const name = tc.function?.name || tc.name;
        const args =
          typeof tc.function?.arguments === "string"
            ? tc.function.arguments
            : JSON.stringify(tc.function?.arguments || tc.arguments || {});
        if (!callId || !name) continue;
        input.push({
          type: "function_call",
          call_id: callId,
          name,
          arguments: args,
        });
      }
      continue;
    }

    if (m.role === "user" || m.role === "assistant") {
      const prose = textOf(m.content);
      if (!prose && m.role === "assistant") continue;
      input.push({
        type: "message",
        role: m.role,
        content: [
          {
            type: m.role === "assistant" ? "output_text" : "input_text",
            text: prose || "",
          },
        ],
      });
    }
  }
  return input;
}

// Reasoning effort the Codex backend accepts. Two places can set it: the
// provider config (`engines.chatgpt-codex.reasoning_effort`, the default for
// every call) and an `@<effort>` suffix on the model id
// (`chatgpt-codex:gpt-5.6-luna@medium`), which wins — so one agent can think
// harder than another on the same plan without a second provider entry.
// Unset = the backend's own default. An unknown suffix is left on the model
// id, where the backend rejects it loudly, rather than silently dropped.
export const CODEX_EFFORTS = Object.freeze(["minimal", "low", "medium", "high", "xhigh"]);

export function splitModelEffort(model, config = {}) {
  const raw = String(model || "");
  const at = raw.lastIndexOf("@");
  if (at > 0) {
    const suffix = raw.slice(at + 1).toLowerCase();
    if (CODEX_EFFORTS.includes(suffix)) return { model: raw.slice(0, at), effort: suffix };
  }
  const fromConfig = String(config?.reasoning_effort || "").toLowerCase();
  return { model: raw, effort: CODEX_EFFORTS.includes(fromConfig) ? fromConfig : null };
}

function extractInstructions(system, messages) {
  if (system) return String(system);
  const first = messages?.[0];
  if (first?.role === "system") return textOf(first.content);
  return "You are a helpful assistant.";
}

/**
 * Consume a Codex Responses SSE stream into the openai-compatible result shape.
 */
async function readResponsesStream(res, onToken, onReasoningToken) {
  let text = "";
  let reasoning = "";
  let finishReason = "stop";
  let usage = { input_tokens: 0, output_tokens: 0 };
  /** @type {Map<string, { id: string, name: string, arguments: string }>} */
  const toolByItem = new Map();
  /** @type {Array<{ id: string, type: string, function: { name: string, arguments: string } }>} */
  const toolCalls = [];
  let rawCompleted = null;

  for await (const ev of streamSseDataEvents(res)) {
    const type = ev?.type || "";

    if (type === "response.output_text.delta") {
      const delta = ev.delta || "";
      if (delta) {
        text += delta;
        if (typeof onToken === "function") onToken(delta);
      }
      continue;
    }

    if (type === "response.reasoning_summary_text.delta" || type === "response.reasoning_text.delta") {
      const delta = ev.delta || "";
      if (delta) {
        reasoning += delta;
        if (typeof onReasoningToken === "function") onReasoningToken(delta);
      }
      continue;
    }

    if (type === "response.output_item.added") {
      const item = ev.item;
      if (item?.type === "function_call") {
        const id = item.call_id || item.id;
        toolByItem.set(item.id || id, {
          id,
          name: item.name || "",
          arguments: typeof item.arguments === "string" ? item.arguments : "",
        });
      }
      continue;
    }

    if (type === "response.function_call_arguments.delta") {
      const key = ev.item_id;
      const row = key ? toolByItem.get(key) : null;
      if (row && ev.delta) row.arguments += ev.delta;
      continue;
    }

    if (type === "response.function_call_arguments.done") {
      const key = ev.item_id;
      const row = key ? toolByItem.get(key) : null;
      if (row) {
        if (ev.arguments != null) row.arguments = String(ev.arguments);
        if (ev.name) row.name = ev.name;
      }
      continue;
    }

    if (type === "response.output_item.done") {
      const item = ev.item;
      if (item?.type === "function_call") {
        const id = item.call_id || item.id;
        toolCalls.push({
          id,
          type: "function",
          function: {
            name: item.name || toolByItem.get(item.id)?.name || "",
            arguments:
              typeof item.arguments === "string"
                ? item.arguments
                : toolByItem.get(item.id)?.arguments || "{}",
          },
        });
        finishReason = "tool_calls";
      }
      continue;
    }

    if (type === "response.completed") {
      rawCompleted = ev.response || ev;
      const u = rawCompleted?.usage;
      if (u) {
        usage = {
          input_tokens: u.input_tokens || u.prompt_tokens || 0,
          output_tokens: u.output_tokens || u.completion_tokens || 0,
        };
      }
      if (rawCompleted?.status === "incomplete") finishReason = "length";
      continue;
    }

    if (type === "response.failed" || type === "error") {
      const msg =
        ev.error?.message ||
        ev.message ||
        ev.response?.error?.message ||
        JSON.stringify(ev).slice(0, 300);
      throw new Error(`codex-plus: ${msg}`);
    }
  }

  // Deduplicate tool calls if both delta-path and done-path filled them.
  const seen = new Set();
  const uniqueTools = [];
  for (const tc of toolCalls) {
    if (!tc.id || seen.has(tc.id)) continue;
    seen.add(tc.id);
    uniqueTools.push(tc);
  }

  return {
    text,
    reasoning,
    tool_calls: uniqueTools.length ? uniqueTools : undefined,
    finish_reason: uniqueTools.length ? "tool_calls" : finishReason,
    usage,
    raw: rawCompleted,
  };
}

const engine = {
  id: "codex-plus",
  needsApiKey: false,
  apiKeyEnv: "",
  defaultBaseUrl: CODEX_PLUS_BASE_URL,
  defaultFallbackModel: "codex-plus:gpt-5.6-luna",

  async health(config = {}) {
    try {
      let creds;
      try {
        creds = await loadCodexPlusCreds(config);
      } catch {
        creds = loadCodexPlusCredsSync(config);
      }
      const left = creds.expires_at
        ? Math.max(0, creds.expires_at - Math.floor(Date.now() / 1000))
        : null;
      const src = creds.source === "apx" ? "APX OAuth" : "CLI borrow";
      return {
        ok: true,
        provider: "codex-plus",
        detail: `${src} · ${creds.auth_path} (account ${String(creds.account_id).slice(0, 8)}…${left != null ? `, token ${Math.round(left / 3600)}h` : ""})`,
      };
    } catch (e) {
      return { ok: false, provider: "codex-plus", reason: e.message };
    }
  },

  async chat({
    system,
    messages = [],
    model,
    maxTokens = 2048,
    config = {},
    tools,
    toolChoice,
    signal,
    onToken,
    onReasoningToken,
  }) {
    if (!model) throw new Error("codex-plus: model required");
    const creds = await loadCodexPlusCreds(config);
    const base = String(config.base_url || CODEX_PLUS_BASE_URL).replace(/\/$/, "");
    const instructions = extractInstructions(system, messages);
    const input = toResponsesInput(messages);
    const responseTools = toResponsesTools(tools);

    const { model: wireModel, effort } = splitModelEffort(model, config);
    const body = {
      model: wireModel,
      instructions,
      input,
      store: false,
      stream: true, // Codex ChatGPT backend rejects non-streaming
    };
    // Official chatgpt.com Codex rejects max_output_tokens (400 Unsupported
    // parameter). Custom proxies may accept it — only send off the official host.
    const official =
      /chatgpt\.com$/i.test(new URL(base.includes("://") ? base : `https://${base}`).hostname) &&
      base.includes("/backend-api/codex");
    if (maxTokens && !official) body.max_output_tokens = maxTokens;
    if (effort) body.reasoning = { effort, summary: "auto" };
    if (responseTools) {
      body.tools = responseTools;
      body.tool_choice =
        toolChoice === "required" || toolChoice === "any"
          ? "required"
          : toolChoice && typeof toolChoice === "object"
            ? toolChoice
            : "auto";
      body.parallel_tool_calls = true;
    }

    const res = await fetch(`${base}/responses`, {
      method: "POST",
      headers: codexPlusHeaders(creds),
      body: JSON.stringify(body),
      signal,
    });

    if (!res.ok) {
      const errText = await res.text().catch(() => "");
      let detail = errText.slice(0, 400);
      try {
        const j = JSON.parse(errText);
        detail = j.detail || j.error?.message || detail;
      } catch {
        /* keep raw */
      }
      throw new Error(`codex-plus ${res.status}: ${detail}`);
    }

    return readResponsesStream(res, onToken, onReasoningToken);
  },

  /** Models from the local Codex CLI cache (no network). */
  listCachedModels(config = {}) {
    return readCodexModelsCache(config);
  },

  resolveAuthPath: resolveCodexAuthPath,
};

export default engine;
export { toResponsesInput, toResponsesTools, readResponsesStream };
