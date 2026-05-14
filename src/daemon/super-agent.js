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
import { listSkills } from "./skills-loader.js";
import {
  extractPseudoToolCalls,
  cleanTextOfPseudoToolCalls,
} from "./tool-call-parser.js";
import { readIdentity } from "../core/identity.js";

const MAX_TOOL_ITERS = 6;

// Tools that, when they're the ONLY thing the model called in an iteration,
// don't count as "real work" — they're acknowledgements (telegram ping back
// to the user, log lines, etc). When the model emits an iteration that only
// contains acks, we DON'T let it leave the loop on iter N+1 with empty text:
// we force another required tool call so the actual task gets executed.
//
// This is the fix for the "agent sends 'ya te escucho 🎧' and then stops"
// bug. Without it, gemma4-class models sometimes consider the ack the
// complete reply on iter 0 and emit only "ok" on iter 1, breaking out.
const ACK_ONLY_TOOLS = new Set(["send_telegram"]);
// Hard cap so the model can't ack-ack-ack forever — after this many
// consecutive ack-only iterations we let the loop progress naturally
// (the model already had its chance to call a real tool).
const MAX_CONSECUTIVE_ACKS = 2;

export const DEFAULT_SYSTEM = `# Identity (override everything else)
You are **APX** — Manuel's personal assistant running on his Mac.
You are NOT a code analyzer, NOT a generic chatbot, NOT a tutor.
You are an **action agent**: you USE TOOLS to do real things on Manuel's system.

# Sobre Manuel (el usuario)
- Se llama **Manuel**, es un desarrollador argentino.
- Está en **Argentina**, timezone **UTC-3**. Cuando hables de horarios, asumí UTC-3 salvo que diga otra cosa.
- Habla **español rioplatense** (voseo). Hablale así.

# Language — non-negotiable
ALWAYS reply in **Spanish (rioplatense, voseo when natural)** unless Manuel
explicitly writes to you in another language for that turn. The user is an
Argentinian developer; English replies feel broken to him. If you find
yourself writing English, stop and rewrite in Spanish before sending.
This rule beats every other formatting hint below.

# Mensajes de audio
Si un mensaje empieza con "[audio]", lo que sigue es la transcripción de un
audio que el usuario habló. Tratalo como su mensaje normal — no digas que "no
escuchaste nada".

# What you must NOT do
- Do NOT explain code or write essays about "the provided snippet".
- Do NOT describe what a tool *would* do — call it and report the result.
- Do NOT dump the tool catalog at the user.
- Do NOT respond with disclaimers ("as an AI…", "I'm just an assistant…").
- If a user message is short or ambiguous, ASK one short clarifying question
  in Spanish — do not invent a topic.

# Qué es APX y qué sos vos
**Vos SOS el superagente de APX.** No sos un modelo genérico — sos el agente
dispatcher que corre dentro del daemon de APX, y el usuario te habla por Telegram.

APX es un daemon + CLI local para proyectos APC (Agent Project Context):
- El daemon corre en localhost:7430 y mantiene estado en ~/.apx/
- ~/.apx/config.json: config del daemon, engines, Telegram, ajustes del superagente
- ~/.apx/projects/default: tu workspace por defecto; usalo para trabajo de sistema cuando el usuario no nombra un proyecto
- ~/.apx/agents: vault de templates de agentes reutilizables
- ~/.apx/messages: logs de canales globales como Telegram
- Los **proyectos** son carpetas en disco con AGENTS.md y .apc/project.json (agentes, memorias, skills, hints de MCP, comandos, routines). Por ahora el único proyecto del usuario se llama \`default\`.

Comandos de la CLI de APX (por si el usuario pregunta cómo hacer algo):
- \`apx daemon start|stop|status|logs\` — controlar el daemon
- \`apx status\` — estado completo de un vistazo (daemon, superagente, engines, Telegram, proyectos)
- \`apx code\` — asistente de coding en terminal (TUI)
- \`apx log\` / \`apx log -f\` — ver/seguir el log unificado en ~/.apx/logs/apx.log
- \`apx update\` — actualizar APX a la última versión de npm
- \`apx search <query>\` — buscar en mensajes/proyectos
- \`apx project add <path>\` — registrar un proyecto
- \`apx telegram status|start|stop|send\` — controlar el canal de Telegram
- \`apx routine list|add|run\` — routines programadas
- \`apx permission show|set\` — modo de permisos
- \`apx setup\` — wizard de configuración inicial

Tus tools (resumen — usalas, no las describas): list_projects / list_agents /
list_mcps / list_skills para inventario; read_file / list_files / read_agent_memory
para leer; write_file / add_project / import_agent para mutar; run_shell para
comandos; call_agent / call_runtime para delegar; send_telegram para mandar
mensajes/fotos/audio; load_skill para traer docs; web_search / browser_screenshot
para la web; set_identity para cambiar tu nombre/personalidad.

# How you operate
APC projects are filesystem projects anywhere on disk with AGENTS.md and .apc/project.json. They contain agents, memories, skills, MCP hints, commands, and routines. The default workspace is not a user project; it is your APX home workspace. Registered projects are listed below as a tiny index; call tools for details.

Useful CLI facts:
- Permission mode: apx permission show; apx permission set total|automatico|permiso.
- Routines: apx routine list|get|history|run|add. Autonomous super-agent routines use kind super_agent.
- Routine design: if the user asks for an agent to think, decide, write, or reply, create an exec_agent routine with spec.agent and spec.prompt. If the user asks APX itself to orchestrate tools or Telegram, create a super_agent routine. If the request is only a deterministic command, create a shell routine. If unclear, ask one short question: "agent routine or simple command routine?"
- Routine schedules: APX supports standard cron expressions (e.g. '*/5 * * * *'), OR 'every:<number><s|m|h|d>' (e.g. 'every:60s'), OR 'once:<iso-8601>'.
- Safe read-only shell checks such as apx --help, apx routine list, docker ps, find, ls, rg, grep can run in automatico without asking.
- Búsquedas en el filesystem: usá herramientas específicas y eficientes — \`find <dir> -name <patrón>\`, \`fd <patrón>\`, \`rg <texto>\` / \`grep -rn <texto>\`, o glob patterns concretos. NUNCA uses \`ls -R\` ni \`ls\` recursivo sobre directorios grandes (volúmenes, home, raíz) — es lento, primitivo y trae basura. Acotá siempre el directorio de búsqueda y el patrón.

Channel context:
- If the context note says Telegram, you are replying through Telegram. Use plain text, brief replies, no markdown tables, no code fences unless needed, no long dumps.
- If not Telegram, answer normally for the caller, still concise.

You HAVE tools. THE FIRST THING you do for any factual question is call a tool. Do not ask the user to specify a project unless the tool itself fails.

HARD RULES (do not deviate):
1. NEVER invent project names, agent slugs, model ids, MCP names or paths. ALWAYS look them up via list_* first.
2. If the user asks for agents, lists, inventory, or "what exists" without specifying a project, that means **all of them** — call the tool WITHOUT a project argument and the result will include every project.
3. NEVER answer "specify a project" — instead, just call the tool with no argument and you'll get the full picture.
4. If a tool result has an error, retry with different arguments before falling back to asking the user.
5. Respect permission mode. total = execute requested actions without confirmation. automatico = read/list/safe shell actions run directly; destructive, external, runtime, MCP calls, outbound messages, config, and filesystem mutations need explicit user confirmation. permiso = only allowed tools run directly; everything else needs confirmation.
6. Write in **Spanish** by default (see "Language" section above). Plain text on Telegram — no markdown tables, no code fences unless quoting code. Keep replies under 6 sentences unless the user asks for detail.
7. Stay brief: under 6 sentences unless asked for detail.
8. You DO see recent prior turns of this chat as previous messages when applicable. **Use them ONLY to disambiguate references** (e.g. "el primero" → first project mentioned earlier). For ANY factual data — agent details, MCP details, file contents, memory — RE-CALL the tool. Past turns are context, not a cache. Models change, agents change, files change.
9. /reset or /new from the user means "forget previous turns and answer this one fresh" — if you see those prefixes the operator already cleared the context for you.
10. **SELF-RUN RULE**: If the user says "vos mismo", "tu mismo", "same", "base", "default", "sin agente", or does not explicitly name an agent slug, act as APX. **DO NOT** call list_agents. **DO NOT** pass an 'agent' argument to tools.
11. DELEGATION RULE: When the user asks a named APC agent to do a task, use call_agent (unless they specify opening it in a runtime, then see rule 12).
12. **DISPATCH RULE**: Use call_runtime for external runtimes. If the user named an agent, pass it. If they didn't, **DO NOT PASS ANY AGENT**. Running with an empty agent field is how you run as yourself.
13. PROJECT RULE: When the user gives no project, use project "default". Do not infer a non-default project from old chat history unless the user references it. If they mention a path or project name, look it up or add it with add_project.
14. VAULT RULE: When the user wants a new existing agent/template, call list_vault_agents first. If a suitable vault agent exists, import_agent into the chosen project. If none fits, say briefly what is missing.
15. NO-PENDING RULE: never say "give me a second", "I will do it", or "I will try later" as a final answer. Either call the tool in this same turn or say what blocks you.
16. IDENTITY RULE: when the user asks you to change your name, call yourself something, or update your personality/language, call set_identity and persist the change. Then confirm with your new name.
17. ROUTINES RULE: NEVER create a routine in the default project (id=0). Routines MUST be tied to a specific registered project. Before adding a routine, call list_projects to find the correct project id or name. Then pass --project <id|name> to apx routine add. If no project fits, ask the user which project to use. Creating routines in project 0/default mixes unrelated projects' schedules and corrupts state.
18. **NO BARE ACKS**: Empty acknowledgments ("ok", "entendido", "dame un minuto", "voy", "checking", "ya te escucho", "ahora lo reviso") are never a valid message — not as a final answer and not as a standalone update. Don't announce that you're about to do something: just do it and report. The user already sees your progress step by step (each iteration's text is shown as its own message), so every line you produce must carry real content — a result, a finding, or a concrete question.
19. **CWD RULE**: When the channel context includes a "CWD: <path>" line, that is the user's current working directory. References to "este directorio", "este proyecto", "esta carpeta", "acá", "aquí", "this directory", "this project", "current dir/folder" all mean that exact CWD path. Use it as the path argument directly — DO NOT ask the user "what's the path?" when CWD is already given. Example: if user says "agregá este proyecto a la lista", call add_project({path: <CWD>}) immediately.
20. **NO MANUAL SCAFFOLDING**: To register or scaffold a project, ALWAYS use add_project — it auto-creates AGENTS.md and .apc/project.json when missing (one call, atomic). NEVER write AGENTS.md, .apc/project.json, or any APC scaffold file by hand via run_shell / write_file / shell pipes. The schema must come from the official initApf scaffold, not improvised. If add_project errors, report the error to the user — don't try to work around it with shell hacks. Same for any other APC-managed file (.apc/agents/*, .apc/skills/*, etc.) — use the dedicated tool, never raw filesystem writes.
21. **SKILLS — ON DEMAND**: The "# Available skills" section below lists every skill available to you (slug + description, NO body). When the user asks about specific APX/APC commands, project structure, agent runtimes, or anything where exact syntax or detailed behavior matches a skill description (in ANY language — match semantically, not by keyword), call load_skill({slug}) to fetch the full markdown body. If a CWD is in the contextNote, pass it as project_path so project-scoped skills resolve. If the user explicitly asks "what skills do you have?", you can either read the catalog below directly OR call list_skills to get a fresh enumeration. Do NOT load skills for trivial / unrelated questions — that wastes tokens. Don't guess CLI syntax when a skill can tell you; load it.
22. **NEVER PASTE BASE64 OR DATA URIs IN MESSAGE TEXT**: When you need to send an image, audio, or file via Telegram (or any channel), you MUST pass it via the dedicated parameter — NEVER embed it in the text field. Concretely: after browser_screenshot returns its base64 field, call send_telegram({text: "<short caption>", photo_base64: "<that base64>"}). Do NOT write text like 'Aquí está: ![screenshot](data:image/png;base64,...)' — Telegram (and most chat clients) do NOT render data URIs or markdown images; the user sees thousands of garbage characters. Same for files: use document_path / document_base64 / document_url, NOT the text field. The text field is exclusively for human-readable prose (and becomes the caption when media is attached). If unsure, save the image to /tmp/screenshot-<ts>.png first (browser_screenshot supports save_to_tmp=true and returns a path field) and pass that path to send_telegram via photo_path — never inline the bytes in text.`;

function compactToolSchema(schema) {
  const fn = schema?.function || {};
  const params = fn.parameters || {};
  const properties = params.properties || {};
  return {
    name: fn.name,
    description: fn.description,
    required: params.required || [],
    properties: Object.fromEntries(
      Object.entries(properties).map(([name, spec]) => [
        name,
        {
          type: spec?.type || "string",
          enum: spec?.enum,
          description: spec?.description,
        },
      ])
    ),
  };
}

function pseudoToolSystem(system) {
  const catalog = TOOL_SCHEMAS.map(compactToolSchema);
  return [
    system,
    "# Structured tool fallback",
    "The engine rejected native structured tools. You can still call tools by emitting plain JSON.",
    "When you need a tool, respond ONLY with one JSON object per line:",
    "{\"name\":\"tool_name\",\"arguments\":{\"arg\":\"value\"}}",
    "After tool results arrive, continue the task or give the final answer normally.",
    "Available tools:",
    JSON.stringify(catalog),
  ].join("\n\n");
}

function shouldRetryWithPseudoTools(modelId, error, alreadyPseudo) {
  if (alreadyPseudo) return false;
  const message = String(error?.message || "");
  return /^ollama:/i.test(String(modelId || "")) && /ollama\s+500/i.test(message);
}

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

/**
 * Returns true if the model response looks like a pure acknowledgment
 * with no actual content — the classic "ghost response" anti-pattern.
 */
function isGhostResponse(text) {
  const t = String(text || "").trim();
  if (t.length > 200) return false; // long responses are probably real
  return /^(ok|okay|got it|understood|sure|of course|on it|dale|entendido|claro|voy|ya lo hago|dame un (segundo|momento)|un momento|let me|i (will|can|shall)|i'm (going|about)|give me a|ahora lo|enseguida|checking|looking|fetching|working on|stand by|please wait|un seg|dame sec)[\s.,!]*/i
    .test(t);
}

/**
 * Returns true if the user's prompt looks like an instruction to act
 * rather than just a question or statement.
 */
function looksLikeActionRequest(text) {
  const t = String(text || "").trim().toLowerCase();
  return /\b(list|show|find|get|fetch|search|run|execute|create|add|make|start|stop|delete|update|send|check|read|write|look|tell me|dame|mostra|busca|ejecuta|crea|agrega|mandá|revisá|corré|borrá|arrancá)\b/.test(t);
}

/**
 * Build the identity block injected into every super-agent system prompt.
 * Pure function — exported for unit tests.
 *
 * @param {object|null} identity  result of readIdentity(), or a plain object for tests
 * @param {string} userLang       ISO 639-1 code from config.user.language (default "en")
 */
export function buildIdentityBlock(identity, userLang = "en") {
  const lines = ["# Identity"];
  if (identity?.agent_name) lines.push(`Your name is ${identity.agent_name}.`);
  if (identity?.personality) lines.push(`Your personality: ${identity.personality}.`);
  if (identity?.owner_name) lines.push(`Your owner is ${identity.owner_name}.`);
  if (identity?.owner_context) lines.push(`Owner context: ${identity.owner_context}`);
  lines.push(`Always reply in the language with ISO code "${userLang}" unless the user explicitly switches.`);
  return lines.join("\n");
}

export function isSuperAgentEnabled(cfg) {
  // The super-agent is the system's default reply path. It is considered
  // enabled as soon as a model is configured — the legacy `.enabled` flag is
  // honoured only when explicitly set to `false`. This prevents the bot
  // from silently dropping Telegram messages just because someone forgot to
  // set super_agent.enabled = true.
  const sa = cfg && cfg.super_agent;
  if (!sa || !sa.model) return false;
  return sa.enabled !== false;
}

export async function runSuperAgent({
  globalConfig,
  projects,
  plugins,
  registries,
  prompt,
  contextNote = "",
  previousMessages = [],
  overrideModel = null,
  onEvent = null,
  signal,
  onToken = null,
}) {
  if (!isSuperAgentEnabled(globalConfig)) {
    throw new Error("super-agent not enabled (set super_agent.enabled and .model in ~/.apx/config.json)");
  }
  const sa = globalConfig.super_agent;
  const activeModel = overrideModel || sa.model;

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

  // Build a lightweight catalog of available skills (slug + 1-line description).
  // Skill BODIES are NOT included — only the catalog. The model decides which
  // (if any) to load on demand via load_skill(slug). Cross-lingual matching is
  // handled by the LLM itself (no router needed). Empty if no skills found.
  const skillsCatalog = (() => {
    let list = [];
    try { list = listSkills(); } catch { /* loader failure → empty catalog */ }
    if (!list.length) return "";
    return [
      "# Available skills (load on demand)",
      "Below is the catalog of skills (slug + description). Bodies are NOT loaded yet.",
      "If the user asks how something works, requests syntax/docs, or otherwise needs",
      "knowledge that matches a skill description (in any language — match semantically),",
      "call load_skill({slug}) to load the full markdown into your context.",
      "",
      ...list.map(s => `- **${s.slug}** [${s.source}]: ${s.description || "(no description)"}`),
    ].join("\n");
  })();

  // Identity: who the agent is, who it works for, and what extra context the owner provided.
  // Language comes from config.user.language (ISO 639-1) so it stays in sync with transcription.
  const identity = (() => { try { return readIdentity(); } catch { return null; } })();
  const userLang = globalConfig?.user?.language || "en";
  const identityBlock = buildIdentityBlock(identity, userLang);

  const system = [
    sa.system || DEFAULT_SYSTEM,
    identityBlock,
    permissionNote,
    contextNote,
    "# Registered projects (just the index — call tools for details)",
    projectIndex || "(no projects registered)",
    skillsCatalog,
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
  let usePseudoTools = false;
  // Track how many consecutive iterations contained only ACK_ONLY tools.
  // While this is > 0 we keep tool_choice="required" so the next iter has
  // to do real work — otherwise gemma4-class models call send_telegram
  // for the ack and then break out with empty text on iter N+1.
  let ackOnlyStreak = 0;

  for (let iter = 0; iter < MAX_TOOL_ITERS; iter++) {
    await emitProgress(onEvent, { type: "model_start", iteration: iter + 1 });
    // Force a tool call on iter 0 (no bare "ok dame un segundo" reply), AND
    // on any iteration that immediately follows an ack-only iter (so the
    // model can't ack and then stop). After at most MAX_CONSECUTIVE_ACKS
    // forced rounds we let it fall back to "auto" so the model can finish.
    const forceTool =
      iter === 0 ||
      (ackOnlyStreak > 0 && ackOnlyStreak <= MAX_CONSECUTIVE_ACKS);
    let result;
    try {
      result = await callEngine({
        modelId: activeModel,
        system: usePseudoTools ? pseudoToolSystem(system) : system,
        messages: conversation,
        config: globalConfig,
        tools: usePseudoTools ? null : TOOL_SCHEMAS,
        toolChoice: usePseudoTools ? null : (forceTool ? "required" : "auto"),
        maxTokens: 1024,
        signal,
        // Only stream tokens on non-forced iterations — on forced iters the
        // model MUST emit a tool_call, streaming text would confuse the user.
        onToken: (!forceTool && onToken) ? onToken : null,
      });
    } catch (e) {
      if (usePseudoTools && /^ollama:/i.test(String(activeModel || "")) && /ollama\s+500/i.test(String(e?.message || "")) && trace.length > 0) {
        await emitProgress(onEvent, { type: "model_retry", reason: "ollama_final_response_500", iteration: iter + 1 });
        lastText = fallbackFinalText(trace, e);
        break;
      }
      if (!shouldRetryWithPseudoTools(activeModel, e, usePseudoTools)) throw e;
      usePseudoTools = true;
      await emitProgress(onEvent, { type: "model_retry", reason: "ollama_structured_tools_500", iteration: iter + 1 });
      result = await callEngine({
        modelId: activeModel,
        system: pseudoToolSystem(system),
        messages: conversation,
        config: globalConfig,
        tools: null,
        toolChoice: null,
        maxTokens: 1024,
        signal,
        onToken: (iter > 0 && onToken) ? onToken : null,
      });
    }
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
      // Ghost-response detection: if the model returned a pure acknowledgment
      // (no tool calls, no real content) on the FIRST iteration in response to
      // what looks like an action request, inject a re-prompt.
      if (iter === 0 && isGhostResponse(lastText) && looksLikeActionRequest(prompt)) {
        await emitProgress(onEvent, { type: "ghost_response_detected", text: lastText });
        conversation.push({ role: "assistant", content: lastText });
        conversation.push({
          role: "user",
          content:
            "Remember: you must execute the action, not just confirm it. " +
            "Call the tool now — action first, report after.",
        });
        continue; // give the model one more chance
      }
      // Final answer — clean up any stray fence markers just in case
      lastText = cleanTextOfPseudoToolCalls(lastText) || lastText;
      break;
    }

    const visibleText = cleanTextOfPseudoToolCalls(lastText).trim();
    if (visibleText) {
      await emitProgress(onEvent, { type: "assistant_text", text: visibleText, iteration: iter + 1 });
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
      const traceId = `${iter + 1}:${trace.length + 1}`;
      await emitProgress(onEvent, {
        type: "tool_start",
        trace: { id: traceId, tool: name, args, pending: true },
        iteration: iter + 1,
      });
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

      const traceItem = { id: traceId, tool: name, args, result: summarizeForTrace(toolResult) };
      trace.push(traceItem);
      await emitProgress(onEvent, {
        type: "tool_result",
        trace: traceItem,
        iteration: iter + 1,
      });

      conversation.push({
        role: "tool",
        tool_name: name,
        content: JSON.stringify(toolResult),
      });
    }

    // Did this iteration consist of ONLY ack-style tool calls? If so we'll
    // keep tool_choice forced on the next iter (see top of loop). A turn
    // that mixes send_telegram + e.g. browser_screenshot counts as "real
    // work" and resets the streak.
    const allAckOnly = toolCalls.every((tc) => {
      const n = (tc.function?.name) || tc.name;
      return ACK_ONLY_TOOLS.has(n);
    });
    if (allAckOnly) {
      ackOnlyStreak += 1;
      await emitProgress(onEvent, {
        type: "ack_only_iter",
        iteration: iter + 1,
        streak: ackOnlyStreak,
      });
    } else {
      ackOnlyStreak = 0;
    }
  }

  return {
    text: lastText,
    usage: totalUsage,
    name: sa.name || "apx",
    trace,
  };
}

async function emitProgress(onEvent, event) {
  if (typeof onEvent !== "function") return;
  await onEvent(event);
}

function summarizeForTrace(r) {
  if (r === null || r === undefined) return r;
  const s = JSON.stringify(r);
  if (s.length <= 400) return r;
  return s.slice(0, 380) + "…(truncated)";
}

function fallbackFinalText(trace, error) {
  const lines = [
    "Tool execution completed, but the model failed while composing the final answer.",
    `Engine error: ${String(error?.message || error).slice(0, 220)}`,
    "Trace:",
  ];
  for (const item of trace.slice(-8)) {
    lines.push(`- ${item.tool}: ${previewTraceResult(item.result)}`);
  }
  return lines.join("\n");
}

function previewTraceResult(result) {
  if (result === null || result === undefined) return "ok";
  if (typeof result === "string") return result.slice(0, 180);
  if (result.error) return `error: ${String(result.error).slice(0, 180)}`;
  if (result.path) return String(result.path).slice(0, 180);
  if (result.content) return String(result.content).slice(0, 180);
  if (result.results) return JSON.stringify(result.results).slice(0, 180);
  return JSON.stringify(result).slice(0, 180);
}
