// Canonical tool names. Every place that mentions a tool by name — handler
// dispatch, allow-lists, prompt rules, the registry bridge skip-set — imports
// the constant from here. Refactor-safe: rename once, the rest follows.
//
// Keep the keys SCREAMING_SNAKE_CASE and the values snake_case (the on-wire
// tool name the LLM sees). The two halves stay aligned so a typo on either
// side is obvious.

export const TOOLS = Object.freeze({
  // Discovery / projects / agents
  LIST_PROJECTS:       "list_projects",
  ADD_PROJECT:         "add_project",
  LIST_AGENTS:         "list_agents",
  LIST_VAULT_AGENTS:   "list_vault_agents",
  IMPORT_AGENT:        "import_agent",
  CREATE_AGENT:        "create_agent",
  SET_AGENT_PROMPT:    "set_agent_prompt",
  WRITE_AGENT_MEMORY:  "write_agent_memory",
  CONFIGURE_AGENT:     "configure_agent",
  REMOVE_AGENT:        "remove_agent",
  LIST_MCPS:           "list_mcps",
  LIST_MCP_TOOLS:      "list_mcp_tools",
  ADD_MCP:             "add_mcp",

  // Memory
  READ_AGENT_MEMORY:   "read_agent_memory",
  READ_SELF_MEMORY:    "read_self_memory",
  REMEMBER:            "remember",

  // Filesystem / shell
  LIST_FILES:          "list_files",
  READ_FILE:           "read_file",
  WRITE_FILE:          "write_file",
  EDIT_FILE:           "edit_file",
  SEARCH_FILES:        "search_files",
  RUN_SHELL:           "run_shell",

  // History / messages / sessions
  TAIL_MESSAGES:       "tail_messages",
  SEARCH_MESSAGES:     "search_messages",
  SEARCH_SESSIONS:     "search_sessions",

  // Skills + dynamic tool surface
  LIST_SKILLS:         "list_skills",
  LOAD_SKILL:          "load_skill",
  DISCOVER_TOOLS:      "discover_tools",

  // Tasks
  LIST_TASKS:          "list_tasks",
  CREATE_TASK:         "create_task",
  COMPLETE_TASK:       "complete_task",
  RECORD_COMMITMENT:   "record_commitment",
  MARK_COMMITMENT:     "mark_commitment",
  REMEMBER_ROUTINE:    "remember_routine",

  // Routines
  LIST_ROUTINES:       "list_routines",
  RUN_ROUTINE:         "run_routine",
  LIST_COMMITMENTS:    "list_commitments",

  // Interaction
  ASK_QUESTIONS:       "ask_questions",
  // Synthesised by run-agent.js rather than living in handlers/ — it is how the
  // model declares the turn is over. It was missing from this catalog, so
  // security.js referenced it as a bare "finish" literal.
  FINISH:              "finish",

  // Delegation / external
  CALL_AGENT:          "call_agent",
  CALL_MCP:            "call_mcp",
  CALL_RUNTIME:        "call_runtime",
  RUN_SUBAGENT:        "run_subagent",

  // Integrations — Asana plugin (see core/integrations/plugins/asana.js)
  ASANA_LIST_PROJECTS: "asana_list_projects",
  ASANA_LIST_TASKS:    "asana_list_tasks",
  ASANA_CREATE_TASK:   "asana_create_task",
  ASANA_UPDATE_TASK:   "asana_update_task",

  // Integrations — GitHub plugin (see core/integrations/plugins/github.js)
  GITHUB_LIST_REPOS:   "github_list_repos",
  GITHUB_CREATE_ISSUE: "github_create_issue",

  // Integrations — Google Calendar plugin (see core/integrations/plugins/calendar.js)
  CALENDAR_LIST_EVENTS:  "calendar_list_events",
  CALENDAR_FIND_SLOT:    "calendar_find_slot",
  CALENDAR_CREATE_EVENT: "calendar_create_event",
  CALENDAR_UPDATE_EVENT: "calendar_update_event",

  // Integrations — Obsidian plugin (see core/integrations/plugins/obsidian.js)
  OBSIDIAN_SEARCH_NOTES: "obsidian_search_notes",
  OBSIDIAN_READ_NOTE:    "obsidian_read_note",
  OBSIDIAN_WRITE_NOTE:   "obsidian_write_note",
  OBSIDIAN_LIST_NOTES:   "obsidian_list_notes",

  // Side-effects
  SEND_TELEGRAM:       "send_telegram",
  SET_IDENTITY:        "set_identity",
  SET_PERMISSION_MODE: "set_permission_mode",
  TRANSCRIBE_AUDIO:    "transcribe_audio",

  // Git — code-channel tools, lazy on chat
  GIT_STATUS:          "git_status",
  GIT_DIFF:            "git_diff",
  GIT_LOG:             "git_log",
  GIT_SHOW:            "git_show",

  // HTTP-bridged registry tools (not native handlers; served via
  // core/tools/registry.js so the regular generic tools work the same way).
  GREP:                "grep",
  GLOB:                "glob",
  FETCH:               "fetch",
  SEARCH:              "search",
});

/**
 * Native handlers in src/core/agent/tools/handlers/ that own these names.
 * The registry bridge MUST skip these — otherwise the HTTP roundtrip would
 * shadow the in-process handler with possibly different semantics.
 */
export const NATIVE_TOOL_NAMES = new Set([
  TOOLS.LIST_PROJECTS,
  TOOLS.LIST_AGENTS,
  TOOLS.LIST_VAULT_AGENTS,
  TOOLS.IMPORT_AGENT,
  TOOLS.CREATE_AGENT,
  TOOLS.SET_AGENT_PROMPT,
  TOOLS.WRITE_AGENT_MEMORY,
  TOOLS.CONFIGURE_AGENT,
  TOOLS.REMOVE_AGENT,
  TOOLS.ADD_MCP,
  TOOLS.COMPLETE_TASK,
  TOOLS.MARK_COMMITMENT,
  TOOLS.ADD_PROJECT,
  TOOLS.LIST_MCPS,
  TOOLS.LIST_MCP_TOOLS,
  TOOLS.READ_AGENT_MEMORY,
  TOOLS.LIST_FILES,
  TOOLS.READ_FILE,
  TOOLS.WRITE_FILE,
  TOOLS.EDIT_FILE,
  TOOLS.SEARCH_FILES,
  TOOLS.RUN_SHELL,
  TOOLS.TAIL_MESSAGES,
  TOOLS.SEARCH_MESSAGES,
  TOOLS.CALL_AGENT,
  TOOLS.CALL_MCP,
  TOOLS.CALL_RUNTIME,
  TOOLS.RUN_SUBAGENT,
  TOOLS.ASANA_LIST_PROJECTS,
  TOOLS.ASANA_LIST_TASKS,
  TOOLS.ASANA_CREATE_TASK,
  TOOLS.ASANA_UPDATE_TASK,
  TOOLS.GITHUB_LIST_REPOS,
  TOOLS.GITHUB_CREATE_ISSUE,
  TOOLS.OBSIDIAN_SEARCH_NOTES,
  TOOLS.OBSIDIAN_READ_NOTE,
  TOOLS.OBSIDIAN_WRITE_NOTE,
  TOOLS.OBSIDIAN_LIST_NOTES,
  TOOLS.CALENDAR_LIST_EVENTS,
  TOOLS.CALENDAR_FIND_SLOT,
  TOOLS.CALENDAR_CREATE_EVENT,
  TOOLS.CALENDAR_UPDATE_EVENT,
  TOOLS.SEND_TELEGRAM,
  TOOLS.SET_IDENTITY,
  TOOLS.SET_PERMISSION_MODE,
  TOOLS.READ_SELF_MEMORY,
  TOOLS.REMEMBER,
  TOOLS.LIST_SKILLS,
  TOOLS.LOAD_SKILL,
  TOOLS.LIST_TASKS,
  TOOLS.CREATE_TASK,
  TOOLS.RECORD_COMMITMENT,
  TOOLS.LIST_COMMITMENTS,
  TOOLS.REMEMBER_ROUTINE,
  TOOLS.LIST_ROUTINES,
  TOOLS.RUN_ROUTINE,
  TOOLS.ASK_QUESTIONS,
  TOOLS.SEARCH_SESSIONS,
  TOOLS.TRANSCRIBE_AUDIO,
  TOOLS.DISCOVER_TOOLS,
  TOOLS.GIT_STATUS,
  TOOLS.GIT_DIFF,
  TOOLS.GIT_LOG,
  TOOLS.GIT_SHOW,
]);

/**
 * Tools that belong in code-shaped channels (apx code, web_code) but should
 * stay lazy on chat surfaces (telegram, web_sidebar, deck, desktop) — there's
 * no point loading `git_diff` schemas in a Telegram chat.
 *
 * Listed separately so registry.js can promote them into the base set when
 * the channel is a coding surface, without touching the chat base.
 */
export const CODE_CHANNEL_TOOLS = Object.freeze([
  TOOLS.GIT_STATUS,
  TOOLS.GIT_DIFF,
  TOOLS.GIT_LOG,
  TOOLS.GIT_SHOW,
]);

/**
 * Read-only allow-list for the Code module's PLAN mode: the agent explores
 * the repo and proposes changes without mutating anything. Build mode uses
 * the full registry — see CODE_BUILD_TOOLS below.
 */
export const CODE_PLAN_TOOLS = Object.freeze([
  TOOLS.READ_FILE,
  TOOLS.LIST_FILES,
  TOOLS.SEARCH_FILES,
  TOOLS.GREP,
  TOOLS.GLOB,
  TOOLS.LIST_PROJECTS,
  TOOLS.LIST_AGENTS,
  TOOLS.LIST_MCPS,
  TOOLS.READ_AGENT_MEMORY,
  TOOLS.READ_SELF_MEMORY,
  TOOLS.SEARCH_SESSIONS,
  TOOLS.SEARCH_MESSAGES,
  TOOLS.TAIL_MESSAGES,
  TOOLS.LIST_SKILLS,
  TOOLS.LOAD_SKILL,
  TOOLS.LIST_TASKS,
  TOOLS.LIST_COMMITMENTS,
  TOOLS.ASK_QUESTIONS,
  TOOLS.FETCH,
  TOOLS.SEARCH,
  // Git tools are read-only on plan mode and let the agent inspect the
  // working state before proposing edits.
  TOOLS.GIT_STATUS,
  TOOLS.GIT_DIFF,
  TOOLS.GIT_LOG,
  TOOLS.GIT_SHOW,
]);

/**
 * BUILD mode = unrestricted. Kept as a sentinel value so callers compare
 * against the constant instead of the magic "*" string. The registry treats
 * "*" as "expose every tool the channel is otherwise allowed to see".
 */
export const CODE_BUILD_TOOLS = "*";

// ---------------------------------------------------------------------------
// Behavioural tool sets
//
// These drive real user-facing protections, so they belong next to the names
// they reference rather than as string literals scattered across the loop. The
// side-effect set in particular was an inline `new Set([...])` inside
// runAgent(): rename a tool there and the de-duplication below silently stops
// working, with the only symptom being a user receiving the same Telegram
// message three times. tests/tool-name-sets.test.js fails if any member here
// stops being a real tool.
// ---------------------------------------------------------------------------

/**
 * Tools that mutate the world. Weak models (Gemini especially) re-emit the
 * same call across iterations; for these we remember the (name + args)
 * signature and answer duplicates with a synthetic "already done" instead of
 * running them again. Read-only tools are exempt — they are idempotent and are
 * legitimately repeated (list_tasks before and after a change).
 */
export const SIDE_EFFECT_TOOLS = new Set([
  TOOLS.SEND_TELEGRAM,
  TOOLS.CREATE_TASK,
  TOOLS.RECORD_COMMITMENT,
  TOOLS.REMEMBER_ROUTINE,
  TOOLS.WRITE_FILE,
  TOOLS.EDIT_FILE,
  TOOLS.RUN_SHELL,
  TOOLS.CALL_RUNTIME,
  TOOLS.ADD_PROJECT,
  TOOLS.CREATE_AGENT,
  TOOLS.SET_AGENT_PROMPT,
  TOOLS.WRITE_AGENT_MEMORY,
  TOOLS.CONFIGURE_AGENT,
  TOOLS.REMOVE_AGENT,
  TOOLS.ADD_MCP,
  TOOLS.COMPLETE_TASK,
  TOOLS.MARK_COMMITMENT,
  TOOLS.SET_IDENTITY,
]);

/**
 * Tools that only acknowledge — the turn has produced no new information for
 * the user, so a run of them is capped (MAX_CONSECUTIVE_ACKS).
 */
export const ACK_ONLY_TOOLS = new Set([TOOLS.SEND_TELEGRAM]);

/**
 * Tools whose semantics REQUIRE handing control back to a human. The loop
 * breaks after these even under a completion contract, because the task
 * cannot advance without a reply. Without it, models under forced toolChoice
 * ask the same question every iteration.
 */
export const TURN_ENDING_TOOLS = new Set([TOOLS.ASK_QUESTIONS]);

/**
 * Tools exempt from the injected `security_risk` parameter: they cannot touch
 * anything, so grading them is noise the model has to pay for on every call.
 */
export const RISK_EXEMPT_TOOLS = new Set([
  TOOLS.FINISH,
  TOOLS.ASK_QUESTIONS,
  TOOLS.DISCOVER_TOOLS,
]);
