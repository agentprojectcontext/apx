// LangChain adapter for the APX super-agent.
//
// Lives alongside the native loop in super-agent.js. Selected via
// config.super_agent.engine === "langchain" (default: "native"). The two
// implementations expose the same shape:
//
//   { text, usage, name, trace }   ← return value
//   { globalConfig, projects, plugins, registries, prompt,
//     previousMessages, contextNote, onEvent, onToken, signal }   ← input
//
// Why a toggle and not a replacement: the native loop carries APX-specific
// features (pseudo-tool fallback for Ollama 500, ghost-response detection,
// permission_mode gates wired through tool handlers, identity-block injection,
// ACK_ONLY_TOOLS streak guard). Re-implementing all of those inside LangChain
// is a large refactor; meanwhile the toggle lets us A/B both paths and pick
// the one that actually behaves better with gemma4-class models on the
// user's hardware.
//
// LangChain version compat: written against @langchain/core ^0.3 +
// langchain ^0.3 + @langchain/anthropic ^0.3 + @langchain/ollama ^0.2.
//
// Limitations vs native loop (acknowledged in v1):
//   - permission_mode confirmations are still enforced inside each tool
//     handler (they return {error: "requires_confirmation: ..."}), but
//     the loop has no UI to ask the user mid-run, so confirmable tools
//     just fail-fast as they do today.
//   - Pseudo-tool fallback (for Ollama 500 on structured tools) is NOT
//     implemented here — if the underlying engine fails, the call
//     propagates. Use engine === "native" for that case.

import { AgentExecutor, createToolCallingAgent } from "langchain/agents";
import { ChatPromptTemplate, MessagesPlaceholder } from "@langchain/core/prompts";
import { DynamicStructuredTool } from "@langchain/core/tools";
import { HumanMessage, AIMessage, ToolMessage } from "@langchain/core/messages";
import { z } from "zod";

import { TOOL_SCHEMAS, makeToolHandlers } from "./super-agent-tools.js";
import { readIdentity } from "../core/identity.js";
import { logInfo, logWarn, logError } from "../core/logging.js";

const MAX_ITER_DEFAULT = 15;

// ---------------------------------------------------------------------------
// JSON-Schema → Zod converter
// ---------------------------------------------------------------------------
// LangChain's DynamicStructuredTool wants a Zod schema. APX's tools ship JSON
// Schema (in the OpenAI function-calling shape). We translate just enough for
// the parameter types APX actually uses: string, number, boolean, object,
// array, enum, optional/required. Anything more exotic falls back to z.any().
function jsonSchemaToZod(schema) {
  if (!schema || typeof schema !== "object") return z.any();
  // OpenAI function shape: { type: "function", function: { parameters: {...} } }
  const root = schema.function?.parameters || schema.parameters || schema;
  return objectToZod(root);
}

function objectToZod(obj) {
  if (!obj || obj.type !== "object" || !obj.properties) {
    return z.object({}).passthrough();
  }
  const required = new Set(obj.required || []);
  const shape = {};
  for (const [key, prop] of Object.entries(obj.properties)) {
    let s = propToZod(prop);
    if (!required.has(key)) s = s.optional();
    if (prop?.description) s = s.describe(prop.description);
    shape[key] = s;
  }
  return z.object(shape);
}

function propToZod(prop) {
  if (!prop || typeof prop !== "object") return z.any();
  if (Array.isArray(prop.enum) && prop.enum.length > 0) {
    return z.enum(prop.enum);
  }
  switch (prop.type) {
    case "string":  return z.string();
    case "number":  return z.number();
    case "integer": return z.number().int();
    case "boolean": return z.boolean();
    case "array":   return z.array(prop.items ? propToZod(prop.items) : z.any());
    case "object":  return objectToZod(prop);
    default:        return z.any();
  }
}

// ---------------------------------------------------------------------------
// APX tool → LangChain DynamicStructuredTool
// ---------------------------------------------------------------------------
function buildLangChainTools(handlers, schemas, { trace, onEvent }) {
  return schemas.map((s) => {
    const name = s.function.name;
    const handler = handlers[name];
    if (!handler) {
      logWarn("super-agent-lc", `no handler for tool ${name} — skipping`);
      return null;
    }
    return new DynamicStructuredTool({
      name,
      description: s.function.description || "",
      schema: jsonSchemaToZod(s),
      func: async (args) => {
        const traceId = `lc:${trace.length + 1}`;
        if (typeof onEvent === "function") {
          try {
            await onEvent({
              type: "tool_start",
              trace: { id: traceId, tool: name, args, pending: true },
            });
          } catch {}
        }
        try {
          const result = await handler(args || {});
          trace.push({ id: traceId, tool: name, args, result });
          if (typeof onEvent === "function") {
            try { await onEvent({ type: "tool_result", trace: { id: traceId, tool: name, args, result } }); } catch {}
          }
          return typeof result === "string" ? result : JSON.stringify(result);
        } catch (e) {
          const errObj = { error: e.message };
          trace.push({ id: traceId, tool: name, args, result: errObj });
          if (typeof onEvent === "function") {
            try { await onEvent({ type: "tool_result", trace: { id: traceId, tool: name, args, result: errObj } }); } catch {}
          }
          return JSON.stringify(errObj);
        }
      },
    });
  }).filter(Boolean);
}

// ---------------------------------------------------------------------------
// Engine factory — picks an @langchain ChatModel based on modelId
// ---------------------------------------------------------------------------
async function makeLangChainModel(modelId, config) {
  // modelId grammar matches engines/index.js: "<provider>:<model>" or
  // an inferable bare model id ("claude-…" → anthropic, etc).
  const [providerRaw, ...rest] = String(modelId || "").split(":");
  let provider = providerRaw.toLowerCase();
  let model = rest.join(":");
  if (!model) {
    // bare id — infer like engines/index.js
    if (/^claude/i.test(providerRaw)) { provider = "anthropic"; model = providerRaw; }
    else if (/^gpt|^o[134]/i.test(providerRaw)) { provider = "openai"; model = providerRaw; }
    else if (/^gemini/i.test(providerRaw)) { provider = "gemini"; model = providerRaw; }
    else { provider = "ollama"; model = providerRaw; }
  }
  const providerCfg = (config && config.engines && config.engines[provider]) || {};

  if (provider === "anthropic") {
    const { ChatAnthropic } = await import("@langchain/anthropic");
    const apiKey = providerCfg.api_key || process.env.ANTHROPIC_API_KEY;
    if (!apiKey) throw new Error("anthropic: no api_key set");
    return new ChatAnthropic({ apiKey, model, temperature: 1.0, maxTokens: 1024 });
  }
  if (provider === "ollama") {
    const { ChatOllama } = await import("@langchain/ollama");
    const baseUrl = providerCfg.base_url || process.env.OLLAMA_HOST || "http://localhost:11434";
    return new ChatOllama({ baseUrl, model, temperature: 0.7 });
  }
  if (provider === "openai") {
    // Lazy import — only required if the user picks openai.
    const { ChatOpenAI } = await import("@langchain/openai").catch(() => ({}));
    if (!ChatOpenAI) throw new Error("openai: install @langchain/openai to use this provider with the langchain engine");
    const apiKey = providerCfg.api_key || process.env.OPENAI_API_KEY;
    if (!apiKey) throw new Error("openai: no api_key set");
    return new ChatOpenAI({ apiKey, model, temperature: 1.0 });
  }
  throw new Error(`langchain engine: unknown provider "${provider}" (modelId="${modelId}")`);
}

// ---------------------------------------------------------------------------
// Convert APX "previousMessages" rows ({role, content}) → LangChain messages
// ---------------------------------------------------------------------------
function toLangChainHistory(previousMessages) {
  return (previousMessages || []).map((m) => {
    if (m.role === "user")      return new HumanMessage(m.content || "");
    if (m.role === "assistant") return new AIMessage(m.content || "");
    if (m.role === "tool") {
      // LangChain ToolMessage requires a tool_call_id; APX doesn't track ids
      // in the FS history, so we use a synthetic one. The agent only sees
      // the content anyway.
      return new ToolMessage({ content: m.content || "", tool_call_id: m.tool_name || "tool" });
    }
    return new HumanMessage(m.content || "");
  });
}

// ---------------------------------------------------------------------------
// Public entry — same contract as runSuperAgent in super-agent.js
// ---------------------------------------------------------------------------
export async function runSuperAgentLangChain({
  globalConfig,
  projects,
  plugins,
  registries,
  prompt,
  previousMessages = [],
  contextNote = "",
  systemOverride = null,
  onEvent,
  onToken,
  signal,
}) {
  const sa = globalConfig?.super_agent || {};
  if (!sa.model) throw new Error("super-agent (langchain): no model configured");

  const identity = (() => { try { return readIdentity(); } catch { return null; } })();
  const userLang = globalConfig?.user?.language || "en";

  // System prompt — we reuse the native module's DEFAULT_SYSTEM unless the
  // caller passes systemOverride. This keeps the personality / language /
  // hard-rules consistent across both engines.
  const { DEFAULT_SYSTEM, buildIdentityBlock } = await import("./super-agent.js");
  const identityBlock = buildIdentityBlock(identity, userLang);
  const systemPieces = [
    systemOverride || sa.system || DEFAULT_SYSTEM,
    identityBlock,
    contextNote,
  ].filter(Boolean);
  // LangChain ChatPromptTemplate uses f-string formatting and will try to
  // resolve any `{name}` it finds in the system text as an input variable.
  // The APX prompt naturally contains literal `{path: <CWD>}` examples and
  // JSON-like snippets, so we double every `{` and `}` to escape them.
  const systemText = systemPieces.join("\n\n").replace(/[{}]/g, (c) => c + c);

  const trace = [];
  const handlers = makeToolHandlers({
    projects, plugins, registries, globalConfig,
    implicitConfirmation: false,
  });
  const tools = buildLangChainTools(handlers, TOOL_SCHEMAS, { trace, onEvent });

  logInfo("super-agent-lc", "starting AgentExecutor", {
    model: sa.model, tools: tools.length, prev: previousMessages.length,
  });

  const llm = await makeLangChainModel(sa.model, globalConfig);

  const promptTemplate = ChatPromptTemplate.fromMessages([
    ["system", systemText],
    new MessagesPlaceholder("chat_history"),
    ["human", "{input}"],
    new MessagesPlaceholder("agent_scratchpad"),
  ]);

  const agent = await createToolCallingAgent({ llm, tools, prompt: promptTemplate });

  const executor = new AgentExecutor({
    agent,
    tools,
    maxIterations: Number(sa.max_iterations) > 0 ? Number(sa.max_iterations) : MAX_ITER_DEFAULT,
    returnIntermediateSteps: true,
    handleParsingErrors: true,
    // verbose is noisy; we already log via core/logging.js
  });

  const t0 = Date.now();
  let result;
  try {
    if (typeof onEvent === "function") {
      try { await onEvent({ type: "model_start", iteration: 1 }); } catch {}
    }
    result = await executor.invoke({
      input: prompt,
      chat_history: toLangChainHistory(previousMessages),
    }, { signal });
  } catch (e) {
    logError("super-agent-lc", `executor failed in ${Date.now() - t0}ms`, { error: e.message });
    throw e;
  }

  // result.output is the final text. result.intermediateSteps is an array
  // of { action, observation }; we already pushed each into `trace` from the
  // DynamicStructuredTool wrappers, so we don't double-record them here.
  const text = String(result.output || "");
  logInfo("super-agent-lc", `done in ${Date.now() - t0}ms`, {
    text_len: text.length,
    tool_calls: trace.length,
  });

  return {
    text,
    // LangChain doesn't surface token counts uniformly across providers;
    // leave 0/0 so the caller's bookkeeping doesn't break. Real values
    // would require provider-specific callback handlers.
    usage: { input_tokens: 0, output_tokens: 0 },
    name: sa.name || "apx",
    trace,
  };
}

export function isLangChainEngineSelected(cfg) {
  return cfg?.super_agent?.engine === "langchain";
}
