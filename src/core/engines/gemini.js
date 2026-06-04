// Google Gemini adapter (https://ai.google.dev/api/generate-content).
// Direct fetch, no SDK. Supports function calling (Gemini's name for tool
// use) so it can drive the super-agent loop on parity with Groq / OpenAI.
import { randomUUID } from "node:crypto";

const API_BASE = "https://generativelanguage.googleapis.com/v1beta/models";

function getKey(config) {
  return config.api_key || process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY || "";
}

// Convert OpenAI-style tool schemas (`{ type: "function", function: { name,
// description, parameters } }`) into Gemini's `functionDeclarations` shape.
function toGeminiTools(toolSchemas) {
  if (!Array.isArray(toolSchemas) || toolSchemas.length === 0) return undefined;
  return [
    {
      functionDeclarations: toolSchemas
        .map((t) => t.function || t)
        .filter((fn) => fn?.name)
        .map((fn) => ({
          name: fn.name,
          description: fn.description || "",
          parameters: fn.parameters || { type: "object", properties: {} },
        })),
    },
  ];
}

// Map our message history into Gemini's `contents` array. Tool results land
// as `role: "function"` parts with a `functionResponse`. Function calls
// emitted by the model in earlier turns become `functionCall` parts under
// `role: "model"`.
function toGeminiContents(messages) {
  const out = [];
  for (const m of messages) {
    if (m.role === "tool") {
      out.push({
        role: "function",
        parts: [
          {
            functionResponse: {
              name: m.name || m.tool_name || "tool",
              response: { content: m.content },
            },
          },
        ],
      });
      continue;
    }
    if (m.role === "assistant" && Array.isArray(m.tool_calls) && m.tool_calls.length > 0) {
      out.push({
        role: "model",
        parts: m.tool_calls.map((tc) => ({
          functionCall: {
            name: tc.function?.name || tc.name,
            args:
              typeof tc.function?.arguments === "string"
                ? safeParseJson(tc.function.arguments)
                : tc.function?.arguments || tc.arguments || {},
          },
        })),
      });
      continue;
    }
    out.push({
      role: m.role === "assistant" ? "model" : "user",
      parts: [{ text: typeof m.content === "string" ? m.content : JSON.stringify(m.content) }],
    });
  }
  return out;
}

function safeParseJson(s) {
  try { return JSON.parse(s); } catch { return {}; }
}

export default {
  id: "gemini",
  needsApiKey: true,
  apiKeyEnv: "GEMINI_API_KEY",
  defaultFallbackModel: "gemini:gemini-2.5-flash",

  async health(config = {}) {
    const key = getKey(config);
    return key
      ? { ok: true, provider: "gemini", soft: true }
      : { ok: false, provider: "gemini", reason: "no api_key" };
  },

  async chat({
    system,
    messages,
    model,
    temperature = 0.7,
    maxTokens = 1024,
    tools,
    toolChoice,
    config = {},
    signal,
  }) {
    const key = getKey(config);
    if (!key) throw new Error("gemini: no api_key (set GEMINI_API_KEY or engines.gemini.api_key)");
    if (!model) throw new Error("gemini: model required");

    const body = {
      contents: toGeminiContents(messages),
      generationConfig: { temperature, maxOutputTokens: maxTokens },
    };
    if (system) body.systemInstruction = { parts: [{ text: system }] };

    const fnTools = toGeminiTools(tools);
    if (fnTools) {
      body.tools = fnTools;
      // Gemini's toolConfig.functionCallingConfig.mode:
      //   AUTO (default), ANY (force a call), NONE (text only).
      if (toolChoice === "required" || toolChoice === "any") {
        body.toolConfig = { functionCallingConfig: { mode: "ANY" } };
      } else if (toolChoice === "none") {
        body.toolConfig = { functionCallingConfig: { mode: "NONE" } };
      }
    }

    const url = `${API_BASE}/${encodeURIComponent(model)}:generateContent?key=${key}`;
    const res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
      signal,
    });
    const json = await res.json();
    if (!res.ok) {
      throw new Error(
        `gemini ${res.status}: ${json?.error?.message || JSON.stringify(json)}`
      );
    }

    const parts = json.candidates?.[0]?.content?.parts || [];
    const text = parts.map((p) => p.text || "").join("");
    // Extract function calls and translate them into the OpenAI-shaped
    // tool_calls the run-agent loop expects.
    const toolCalls = [];
    for (const p of parts) {
      const fc = p.functionCall || p.function_call;
      if (fc?.name) {
        toolCalls.push({
          id: `gemini_${randomUUID().slice(0, 8)}`,
          type: "function",
          function: {
            name: fc.name,
            arguments: typeof fc.args === "string" ? fc.args : JSON.stringify(fc.args || {}),
          },
        });
      }
    }

    return {
      text,
      tool_calls: toolCalls.length > 0 ? toolCalls : undefined,
      finish_reason: json.candidates?.[0]?.finishReason || null,
      usage: {
        input_tokens: json.usageMetadata?.promptTokenCount || 0,
        output_tokens: json.usageMetadata?.candidatesTokenCount || 0,
      },
      raw: json,
    };
  },
};
