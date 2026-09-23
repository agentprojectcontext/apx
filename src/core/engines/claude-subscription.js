// Claude subscription engine — Claude Max (+ extra credits) via APX OAuth.
// Messages API with Bearer + claude-code identity (same wire as Hermes/Claude Code).

import { streamSseDataEvents } from "./_streaming.js";
import {
  claudeSubscriptionAuthPath,
  claudeSubscriptionHeaders,
  resolveApxClaudeCreds,
  readApxClaudeAuth,
} from "./claude-subscription-oauth.js";

const API_BASE = "https://api.anthropic.com/v1/messages";

function contentForAnthropic(m) {
  const text = typeof m.content === "string" ? m.content : JSON.stringify(m.content ?? "");
  const imgs = Array.isArray(m.images)
    ? m.images.filter((im) => im && im.data && im.mime)
    : [];
  if (!imgs.length) return text;
  return [
    ...(text ? [{ type: "text", text }] : []),
    ...imgs.map((im) => ({
      type: "image",
      source: { type: "base64", media_type: im.mime, data: im.data },
    })),
  ];
}

const engine = {
  id: "claude-subscription",
  needsApiKey: false,
  apiKeyEnv: "",
  defaultBaseUrl: "https://api.anthropic.com",
  defaultFallbackModel: "claude-subscription:claude-sonnet-4-5",

  async health() {
    const stored = readApxClaudeAuth();
    if (!stored) {
      return {
        ok: false,
        provider: "claude-subscription",
        reason: `no APX login — run \`apx auth claude login\` (${claudeSubscriptionAuthPath()})`,
      };
    }
    try {
      const creds = await resolveApxClaudeCreds();
      const leftMs = creds.expires_at_ms ? Math.max(0, creds.expires_at_ms - Date.now()) : null;
      return {
        ok: true,
        provider: "claude-subscription",
        detail: `APX OAuth · ${creds.auth_path}${leftMs != null ? ` (token ~${Math.round(leftMs / 3600_000)}h)` : ""}`,
      };
    } catch (e) {
      return { ok: false, provider: "claude-subscription", reason: e.message };
    }
  },

  async chat({
    system,
    messages = [],
    model,
    temperature = 1.0,
    maxTokens = 1024,
    tools,
    toolChoice,
    signal,
    onToken,
  }) {
    if (!model) throw new Error("claude-subscription: model required");
    const creds = await resolveApxClaudeCreds();
    const headers = claudeSubscriptionHeaders(creds.access_token);

    const body = {
      model,
      max_tokens: maxTokens,
      temperature,
      messages: messages.map((m) => ({
        role: m.role === "assistant" ? "assistant" : "user",
        content: contentForAnthropic(m),
      })),
    };
    if (system) body.system = system;
    if (tools && tools.length > 0) {
      body.tools = tools;
      if (toolChoice === "required" || toolChoice === "any") {
        body.tool_choice = { type: "any" };
      } else if (toolChoice && typeof toolChoice === "object") {
        body.tool_choice = toolChoice;
      }
    }

    if (typeof onToken === "function" && toolChoice !== "required" && toolChoice !== "any") {
      body.stream = true;
      const res = await fetch(API_BASE, {
        method: "POST",
        headers,
        body: JSON.stringify(body),
        signal,
      });
      if (!res.ok) {
        const err = await res.text().catch(() => "");
        throw new Error(`claude-subscription ${res.status}: ${err.slice(0, 200)}`);
      }
      let text = "";
      let inputTokens = 0;
      let outputTokens = 0;
      let stopReason = null;
      for await (const evt of streamSseDataEvents(res)) {
        if (evt.type === "content_block_delta" && evt.delta?.type === "text_delta") {
          const t = evt.delta.text || "";
          if (t) { text += t; onToken(t); }
        } else if (evt.type === "message_delta") {
          stopReason = evt.delta?.stop_reason || stopReason;
          outputTokens = evt.usage?.output_tokens || outputTokens;
        } else if (evt.type === "message_start") {
          inputTokens = evt.message?.usage?.input_tokens || 0;
          outputTokens = evt.message?.usage?.output_tokens || 0;
        }
      }
      return {
        text,
        stop_reason: stopReason,
        finish_reason: stopReason,
        usage: { input_tokens: inputTokens, output_tokens: outputTokens },
        raw: null,
      };
    }

    const res = await fetch(API_BASE, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
      signal,
    });
    const raw = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new Error(
        `claude-subscription ${res.status}: ${raw?.error?.message || JSON.stringify(raw).slice(0, 200)}`
      );
    }
    const blocks = Array.isArray(raw.content) ? raw.content : [];
    const text = blocks.filter((b) => b.type === "text").map((b) => b.text || "").join("");
    return {
      text,
      stop_reason: raw.stop_reason,
      finish_reason: raw.stop_reason,
      usage: {
        input_tokens: raw.usage?.input_tokens || 0,
        output_tokens: raw.usage?.output_tokens || 0,
      },
      raw,
    };
  },
};

export default engine;
