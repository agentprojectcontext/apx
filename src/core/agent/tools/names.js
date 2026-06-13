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
  LIST_MCPS:           "list_mcps",

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

  // Interaction
  ASK_QUESTIONS:       "ask_questions",

  // Delegation / external
  CALL_AGENT:          "call_agent",
  CALL_MCP:            "call_mcp",
  CALL_RUNTIME:        "call_runtime",

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
  TOOLS.ADD_PROJECT,
  TOOLS.LIST_MCPS,
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
  TOOLS.SEND_TELEGRAM,
  TOOLS.SET_IDENTITY,
  TOOLS.SET_PERMISSION_MODE,
  TOOLS.READ_SELF_MEMORY,
  TOOLS.REMEMBER,
  TOOLS.LIST_SKILLS,
  TOOLS.LOAD_SKILL,
  TOOLS.LIST_TASKS,
  TOOLS.CREATE_TASK,
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
