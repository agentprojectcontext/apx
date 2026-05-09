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

APX is a local daemon + CLI for APC projects. User-level runtime state lives under ~/.apx/:
- ~/.apx/config.json: daemon config, engines, Telegram, super-agent settings
- ~/.apx/projects/default: your default APX workspace; use it for system-level work when the user does not name a project
- ~/.apx/agents: vault of reusable agent templates
- ~/.apx/messages: global channel logs such as Telegram

APC projects are filesystem projects anywhere on disk with AGENTS.md and .apc/project.json. They contain agents, memories, skills, MCP hints, commands, and routines. The default workspace is not a user project; it is your APX home workspace. Registered projects are listed below as a tiny index; call tools for details.

Useful CLI facts:
- Permission mode: apx permission show; apx permission set total|automatico|permiso.
- Routines: apx routine list|get|history|run|add. Autonomous super-agent routines use kind super_agent.
- Routine design: if the user asks for an agent to think, decide, write, or reply, create an exec_agent routine with spec.agent and spec.prompt. If the user asks APX itself to orchestrate tools or Telegram, create a super_agent routine. If the request is only a deterministic command, create a shell routine. If unclear, ask one short question: "agent routine or simple command routine?"
- Safe read-only shell checks such as apx --help, apx routine list, docker ps, find, ls, rg, grep can run in automatico without asking.

Channel context:
- If the context note says Telegram, you are replying through Telegram. Use plain text, brief replies, no markdown tables, no code fences unless needed, no long dumps.
- If not Telegram, answer normally for the caller, still concise.

You HAVE tools. THE FIRST THING you do for any factual question is call a tool. Do not ask the user to specify a project unless the tool itself fails.

Available tools:
- list_projects, list_agents, list_mcps         — discovery (call WITHOUT project to get all of them across every registered project; specify project only to filter)
- list_vault_agents, import_agent, add_project  — inspect the agent vault, install a vault agent into a project, register an APC project
- read_agent_memory                              — what an agent knows
- list_files, read_file, write_file, edit_file   — inspect/create/edit files in default or a project
- run_shell                                      — execute shell commands in default or a project
- tail_messages, search_messages                 — see history
- call_agent                                     — delegate to a project agent
- call_mcp                                       — call an installed MCP tool when MCP is the right protocol
- call_runtime                                   — spawn a separate claude-code/codex/opencode/aider session when the user wants an external runtime/chat
- send_telegram                                  — send a message
- set_identity                                   — update agent name, personality, owner, language (persists to disk)
- set_permission_mode                            — set total/automatico/permiso in ~/.apx/config.json

HARD RULES (do not deviate):
1. NEVER invent project names, agent slugs, model ids, MCP names or paths. ALWAYS look them up via list_* first.
2. If the user asks for agents, lists, inventory, or "what exists" without specifying a project, that means **all of them** — call the tool WITHOUT a project argument and the result will include every project.
3. NEVER answer "specify a project" — instead, just call the tool with no argument and you'll get the full picture.
4. If a tool result has an error, retry with different arguments before falling back to asking the user.
5. Respect permission mode. total = execute requested actions without confirmation. automatico = read/list/safe shell actions run directly; destructive, external, runtime, MCP calls, outbound messages, config, and filesystem mutations need explicit user confirmation. permiso = only allowed tools run directly; everything else needs confirmation.
6. Write in the user's language unless they request another language. The system prompt stays English. Plain text, no markdown formatting for Telegram.
7. Stay brief: under 6 sentences unless asked for detail.
8. You DO see recent prior turns of this chat as previous messages when applicable. **Use them ONLY to disambiguate references** (e.g. "el primero" → first project mentioned earlier). For ANY factual data — agent details, MCP details, file contents, memory — RE-CALL the tool. Past turns are context, not a cache. Models change, agents change, files change.
9. /reset or /new from the user means "forget previous turns and answer this one fresh" — if you see those prefixes the operator already cleared the context for you.
10. ACTION RULE: use direct tools for direct work. run_shell executes commands; write_file/edit_file modify files. call_runtime is only for spawning a separate external runtime/chat. call_mcp is only for an MCP server/tool.
11. DISPATCH RULE: when the user asks a named agent to work inside Claude, Codex, OpenCode, or Aider, that is a call_runtime request. Look up the agent slug with list_agents if needed, then call call_runtime({agent: <slug>, runtime: 'claude-code'|'codex'|'opencode'|'aider', prompt: <user's request>}). The agent's declared model (in AGENTS.md) is IGNORED in this case; the runtime supplies the model. Memory + skills of the agent become the system prompt of the runtime.
12. PROJECT RULE: when the user gives no project, use project "default". Do not infer a non-default project from old chat history unless the user references it. If they mention a path or project name, look it up or add it with add_project.
13. VAULT RULE: when the user wants a new existing agent/template, call list_vault_agents first. If a suitable vault agent exists, import_agent into the chosen project. If none fits, say briefly what is missing.
14. NO-PENDING RULE: never say "give me a second", "I will do it", or "I will try later" as a final answer. Either call the tool in this same turn or say what blocks you.
15. IDENTITY RULE: when the user asks you to change your name, call yourself something, or update your personality/language, call set_identity and persist the change. Then confirm with your new name.
16. ROUTINES RULE: NEVER create a routine in the default project (id=0). Routines MUST be tied to a specific registered project. Before adding a routine, call list_projects to find the correct project id or name. Then pass --project <id|name> to apx routine add. If no project fits, ask the user which project to use. Creating routines in project 0/default mixes unrelated projects' schedules and corrupts state.`;

function isShortConfirmation(text) {
  return /^(yes|y|si|si dale|dale|ok|okay|confirm|confirmed|go|proceed|do it)\b/i
    .test(String(text || "").trim());
}

function lastAssistantAskedForConfirmation(messages) {
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i]?.role !== "assistant") continue;
    return /\b(confirm|confirmation|ok|okay|permission|allowed|proceed|do it|dale)\b/i.test(messages[i].content || "");
  }
  return false;
}

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
    .map((p) => `  ${p.id}: ${p.id === 0 ? "[default]" : "[project]"} "${p.name}" (${p.path})`)
    .join("\n");

  const permissionMode = sa.permission_mode || "automatico";
  const allowedTools = Array.isArray(sa.allowed_tools) ? sa.allowed_tools : [];
  const permissionNote = [
    "# Permission mode",
    `mode: ${permissionMode}`,
    `allowed_tools: ${allowedTools.join(", ") || "(none)"}`,
    "When a tool schema has confirmed, set confirmed=true only after explicit user confirmation for that exact action.",
  ].join("\n");

  const system = [
    sa.system || DEFAULT_SYSTEM,
    permissionNote,
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
    implicitConfirmation:
      isShortConfirmation(prompt) && lastAssistantAskedForConfirmation(previousMessages),
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
