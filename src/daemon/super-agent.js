// Super-agent: a daemon-level agent that responds on Telegram when no
// per-project agent is configured. Has native function-calling tools to
// inspect projects/agents/MCPs and to call agents and MCPs directly.
//
// Config:
//   {
//     "super_agent": {
//       "enabled": true,
//       "model": "ollama:qwen2.5:14b",   // must support tool use
//       "name": "apx",
//       "system": "..."                   // optional; defaults below
//     }
//   }
import { callEngine } from "./engines/index.js";
import { TOOL_SCHEMAS, makeToolHandlers } from "./super-agent-tools.js";
import {
  extractPseudoToolCalls,
  cleanTextOfPseudoToolCalls,
} from "./tool-call-parser.js";

const MAX_TOOL_ITERS = 6;

const DEFAULT_SYSTEM = `You are the **APX dispatcher** — the daemon-level agent that runs above all APC projects.

You HAVE tools. THE FIRST THING you do for any factual question is call a tool. Do not ask the user to specify a project unless the tool itself fails.

Available tools:
- list_projects, list_agents, list_mcps         — discovery (call WITHOUT project to get all of them across every registered project; specify project only to filter)
- read_agent_memory                              — what an agent knows
- list_files, read_file                          — inspect any project
- tail_messages, search_messages                 — see history
- call_agent                                     — delegate to a project agent
- call_mcp                                       — call an MCP tool
- call_runtime                                   — spawn claude-code/codex/opencode/aider
- send_telegram                                  — send a message
- set_identity                                   — update agent name, personality, owner, language (persists to disk)

HARD RULES (do not deviate):
1. NEVER invent project names, agent slugs, model ids, MCP names or paths. ALWAYS look them up via list_* first.
2. If the user says "los agentes" / "lista" / "qué hay" without specifying a project, that means **all of them** — call the tool WITHOUT a project argument and the result will include every project.
3. NEVER answer "specify a project" — instead, just call the tool with no argument and you'll get the full picture.
4. If a tool result has an error, retry with different arguments before falling back to asking the user.
5. Don't ask permission — the operator left you unrestricted.
6. Default language: es-AR. Plain text, no markdown formatting (Telegram doesn't render it).
7. Stay brief: under 6 sentences unless asked for detail.
8. You DO see recent prior turns of this chat as previous messages when applicable. **Use them ONLY to disambiguate references** (e.g. "el primero" → first project mentioned earlier). For ANY factual data — agent details, MCP details, file contents, memory — RE-CALL the tool. Past turns are context, not a cache. Models change, agents change, files change.
9. /reset or /new from the user means "forget previous turns and answer this one fresh" — if you see those prefixes the operator already cleared the context for you.
10. DISPATCH RULE: when the user says things like "que <agente> haga X", "iniciá una sesión con Claude/Codex", "que <agente> arranque <runtime>", "andá a <runtime> y hacé X" — that is a call_runtime request. Look up the agent slug with list_agents if needed, then call call_runtime({agent: <slug>, runtime: 'claude-code'|'codex'|'opencode'|'aider', prompt: <user's request>}). The agent's declared model (in AGENTS.md) is IGNORED in this case; the runtime supplies the model. Memory + skills of the agent become the system prompt of the runtime. Don't ask "are you sure?" — just dispatch.
11. IDENTITY RULE: when the user asks you to change your name ("llamame X", "call yourself X", "tu nombre es X"), or update your personality/language, call set_identity immediately and persist the change. Then confirm with your new name.`;

export function isSuperAgentEnabled(cfg) {
  return !!(cfg && cfg.super_agent && cfg.super_agent.enabled && cfg.super_agent.model);
}

export async function runSuperAgent({
  globalConfig,
  projects,
  plugins,
  registries,
  prompt,
  contextNote = "",
  previousMessages = [],
}) {
  if (!isSuperAgentEnabled(globalConfig)) {
    throw new Error("super-agent not enabled (set super_agent.enabled and .model in ~/.apx/config.json)");
  }
  const sa = globalConfig.super_agent;

  // Tiny project hint — JUST names + ids, no detail. The model is expected to
  // call list_agents / list_mcps / read_agent_memory / etc. for everything
  // else. Keeping this short forces actual tool use instead of letting the
  // model answer from a cached snapshot.
  const projectIndex = projects
    .list()
    .map((p) => `  ${p.id}: "${p.name}" (${p.path})`)
    .join("\n");

  const system = [
    sa.system || DEFAULT_SYSTEM,
    contextNote,
    "# Registered projects (just the index — call tools for details)",
    projectIndex || "(no projects registered)",
  ]
    .filter(Boolean)
    .join("\n\n");

  // Build tools and handler map
  const handlers = makeToolHandlers({
    projects,
    plugins,
    registries,
    globalConfig,
  });

  // Agent loop: call model → if tool_calls, execute and feed back; repeat.
  // Inject any prior turns the caller passed (e.g. recent Telegram history)
  // so the model has multi-turn context.
  const conversation = [...previousMessages, { role: "user", content: prompt }];
  const trace = [];
  let totalUsage = { input_tokens: 0, output_tokens: 0 };
  let lastText = "";

  for (let iter = 0; iter < MAX_TOOL_ITERS; iter++) {
    const result = await callEngine({
      modelId: sa.model,
      system,
      messages: conversation,
      config: globalConfig,
      tools: TOOL_SCHEMAS,
      maxTokens: 1024,
    });
    totalUsage.input_tokens += result.usage?.input_tokens || 0;
    totalUsage.output_tokens += result.usage?.output_tokens || 0;
    lastText = result.text || "";

    let toolCalls = result.tool_calls || (result.message && result.message.tool_calls) || null;

    // Some models (qwen2.5 in particular) emit tool calls as plain text
    // instead of using the structured field. If we don't find structured
    // tool_calls, scan the text for the pseudo-format and treat them the
    // same. We also clean the visible text so the leftover `_icall()` and
    // {"name":...} junk never reaches the user as a final answer.
    if ((!toolCalls || toolCalls.length === 0) && lastText) {
      const pseudo = extractPseudoToolCalls(lastText);
      if (pseudo.length > 0) {
        toolCalls = pseudo;
        lastText = cleanTextOfPseudoToolCalls(lastText);
      }
    }

    if (!toolCalls || toolCalls.length === 0) {
      // Final answer — clean up any stray fence markers just in case
      lastText = cleanTextOfPseudoToolCalls(lastText) || lastText;
      break;
    }

    // Append the assistant turn (with its tool_calls) and execute each call.
    conversation.push({
      role: "assistant",
      content: result.text || "",
      tool_calls: toolCalls,
    });

    for (const tc of toolCalls) {
      const fn = tc.function || tc; // some adapters bury it deeper
      const name = fn.name;
      let args = fn.arguments;
      if (typeof args === "string") {
        try { args = JSON.parse(args); } catch { args = {}; }
      }
      args = args || {};

      let toolResult;
      try {
        const handler = handlers[name];
        if (!handler) {
          toolResult = { error: `unknown tool: ${name}` };
        } else {
          toolResult = await handler(args);
        }
      } catch (e) {
        toolResult = { error: e.message };
      }

      trace.push({ tool: name, args, result: summarizeForTrace(toolResult) });

      conversation.push({
        role: "tool",
        tool_name: name,
        content: JSON.stringify(toolResult),
      });
    }
  }

  return {
    text: lastText,
    usage: totalUsage,
    name: sa.name || "apx",
    trace,
  };
}

function summarizeForTrace(r) {
  if (r === null || r === undefined) return r;
  const s = JSON.stringify(r);
  if (s.length <= 400) return r;
  return s.slice(0, 380) + "…(truncated)";
}
