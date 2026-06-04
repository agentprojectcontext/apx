// Tools that overlap with post_command output sinks.
//
// A routine of kind=super_agent that has post_commands like
//   `apx telegram send "$APX_LLM_OUTPUT"`
// will already pipe the model's final text into Telegram. If the agent's tool
// registry still exposes `send_telegram`, the model can also call it inside
// the loop — producing two messages. See spec/backlog/01-routine-output-coherence.md.
//
// The map below pairs shell command prefixes with the tools that would
// duplicate them. We match prefixes (not exact strings) because users join
// commands with pipes, $vars, and quoting.

export const POSTCMD_TOOL_OVERLAP = Object.freeze({
  "apx telegram send":       ["send_telegram"],
  "apx telegram notify":     ["send_telegram"],
  "apx telegram send_photo": ["send_telegram"],
  "apx telegram send_voice": ["send_telegram"],
  "apx telegram send_audio": ["send_telegram"],
  "apx voice say":           ["say_voice"], // reserved for the future voice tool
});

/**
 * Given a list of post_commands shell strings, return the set of tool names
 * that should be suppressed for the same routine's LLM invocation.
 *
 * Matching is by command prefix after trimming leading whitespace. Pipelines
 * (`curl ... | apx telegram send`) and `&&`/`;` chains are walked so the
 * detection isn't fooled by `cmd1 && apx telegram send …`.
 */
export function computeSuppressedTools(postCommands) {
  if (!Array.isArray(postCommands) || postCommands.length === 0) return [];
  const suppressed = new Set();
  for (const raw of postCommands) {
    if (typeof raw !== "string") continue;
    // Split on shell-ish boundaries that introduce a new command.
    // Keep this conservative — false negatives (under-suppression) are
    // recoverable; false positives (over-suppression) silently disable tools.
    const segments = raw.split(/\s*(?:&&|\|\||;|\|)\s*/);
    for (const segRaw of segments) {
      const seg = segRaw.trim();
      for (const [prefix, tools] of Object.entries(POSTCMD_TOOL_OVERLAP)) {
        if (seg.startsWith(prefix)) {
          for (const t of tools) suppressed.add(t);
        }
      }
    }
  }
  return [...suppressed];
}

/**
 * Filter a tool-schemas array, removing any tool whose name appears in the
 * suppress set. Returns a new array; the original is not mutated.
 *
 * Works with the OpenAI-style schema (`{ type: "function", function: { name } }`)
 * and bare `{ name }` shapes — anything else is kept as-is.
 */
export function filterToolSchemas(toolSchemas, suppress) {
  if (!Array.isArray(toolSchemas) || toolSchemas.length === 0) return toolSchemas;
  if (!Array.isArray(suppress) || suppress.length === 0) return toolSchemas;
  const drop = new Set(suppress);
  return toolSchemas.filter((t) => {
    const name = t?.function?.name || t?.name;
    return !drop.has(name);
  });
}
