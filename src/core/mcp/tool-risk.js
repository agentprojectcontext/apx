// Is an MCP tool a read or a write?
//
// `call_mcp` is ONE tool that reaches EVERY tool of every MCP a project has.
// That makes an agent's tool list a much weaker statement than it looks: the
// council agents declare a read-only set — no create_task, no write_file, no
// run_shell — and then `call_mcp` sits in that same list able to reach
// `appsi_send_campaign`, `appsi_update_tenant` and `appsi_delete_campaign`.
// The guarantee was good behaviour, not construction. (On the live project the
// CFO never did: 33 calls, all reads. Nothing stopped it.)
//
// Marking `call_mcp` dangerous wholesale — what it did before — is no better in
// the other direction: under `automatico` it makes every MCP READ ask for
// confirmation too, and in a routine there is nobody to ask, so the run simply
// loses the sources it needed. Blocking the reads to stop the writes is how a
// safety feature gets turned off.
//
// So: grade the call by the tool it is actually about to make.
//
// THREE SOURCES, IN THIS ORDER. The name heuristic is the LAST of them, and it
// is a guess — the token lists below were grown against two servers (knot and
// appsi) and they only know the English words those two happened to use. A
// third server names a reader `cheto_areas` and the guess has nothing to go
// on, fails closed, and a scheduled run loses a source it was entitled to.
// That is not a bug in the list, it is the ceiling of guessing from a name.
//
//   1. `annotations.readOnlyHint` — the MCP spec's own field. The server that
//      implements the tool says what it does. Nothing beats it.
//   2. `read_only_tools` / `write_tools` on the MCP's entry in mcps.json —
//      the operator saying it instead, for a server that declares nothing:
//        "cheto": { "command": …, "read_only_tools": ["cheto_areas", "cheto_*s"] }
//      Same authority as (1) and for the same reason: somebody who knows what
//      the tool does wrote it down. Entries may use `*` as a wildcard.
//   3. the token heuristic, for the servers nobody has described.

/**
 * Verbs that CHANGE something, matched as a token anywhere in the name — not
 * as a prefix. Real servers put the verb wherever: `knot_memory_write`,
 * `knot_task_accept`, `appsi_add_ticket_message`, `knot_channel_post`.
 */
const WRITE_TOKENS = new Set([
  "create", "update", "delete", "remove", "destroy", "drop", "write", "post",
  "send", "add", "set", "put", "patch", "insert", "edit", "rename", "move",
  "assign", "claim", "accept", "reject", "approve", "answer", "request",
  "comment", "tag", "untag", "archive", "close", "cancel", "reopen",
  "pause", "resume", "start", "stop", "restart", "kill", "run", "exec",
  "import", "upload", "publish", "deploy", "install", "uninstall",
  "sync", "resend", "verify", "mark", "trigger", "invite", "revoke",
  "clear", "reset", "apply", "submit", "heartbeat",
]);

/**
 * Words that only ever READ. Plural bare nouns are here on purpose: a lot of
 * servers name a collection getter after the collection (`knot_tasks`,
 * `knot_channels`, `knot_reviews`) with no verb at all.
 */
const READ_TOKENS = new Set([
  "list", "get", "search", "read", "find", "query", "fetch", "describe",
  "show", "view", "stats", "count", "info", "detail", "details", "diff",
  "history", "logs", "log", "preview", "inspect", "whoami", "inbox",
  "tools", "tasks", "channels", "reviews", "memory", "notes", "messages",
  "projects", "items", "unreported",
]);

/**
 * Does `tool` match any entry of a declared list? Entries are exact names or
 * shell-style globs (`cheto_*`), compared case-insensitively.
 */
function matchesAny(tool, list) {
  if (!Array.isArray(list) || list.length === 0) return null;
  const name = String(tool || "");
  const quote = (chunk) => chunk.replace(/[.*+?^${}()|[\]\\]/g, (c) => "\\" + c);
  return (
    list.find((pat) => {
      if (typeof pat !== "string" || !pat) return false;
      if (!pat.includes("*")) return pat.toLowerCase() === name.toLowerCase();
      const re = new RegExp(`^${pat.split("*").map(quote).join(".*")}$`, "i");
      return re.test(name);
    }) || null
  );
}

/** `appsi_list_apps` → ["appsi","list","apps"]. Handles camelCase too. */
function tokens(name) {
  return String(name || "")
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
}

/**
 * @param {string} tool  the tool name on the MCP server
 * @param {object} [descriptor]  that tool as the server described it, when the
 *   caller has it. `annotations.readOnlyHint` is part of the MCP spec and is
 *   AUTHORITATIVE: a server that tells us what its own tool does beats any
 *   guess we make from its name. Neither of the servers this was written
 *   against declares one, which is why (2) and (3) exist at all.
 * @param {object} [declared]  the MCP's own entry from mcps.json, for its
 *   `read_only_tools` / `write_tools` lists. `write_tools` is consulted first
 *   so an explicit write still wins under a broad read glob.
 * @returns {{dangerous: boolean, reason: string}}
 */
export function mcpToolRisk(tool, descriptor = null, declared = null) {
  const hint = descriptor?.annotations?.readOnlyHint;
  if (hint === true) return { dangerous: false, reason: "the server declares it read-only" };
  if (hint === false) return { dangerous: true, reason: "the server declares it not read-only" };

  const asWrite = matchesAny(tool, declared?.write_tools);
  if (asWrite) return { dangerous: true, reason: `listed in this MCP's write_tools ("${asWrite}")` };
  const asRead = matchesAny(tool, declared?.read_only_tools);
  if (asRead) return { dangerous: false, reason: `listed in this MCP's read_only_tools ("${asRead}")` };

  const parts = tokens(tool);
  const write = parts.find((p) => WRITE_TOKENS.has(p));
  if (write) return { dangerous: true, reason: `"${write}" changes something` };

  const read = parts.find((p) => READ_TOKENS.has(p));
  if (read) return { dangerous: false, reason: `"${read}" only reads` };

  // Neither — and this is where it stays CLOSED. A read wrongly gated is a
  // source that reports itself unavailable, which is visible and recoverable;
  // a write wrongly let through is a campaign that went out. The costs are not
  // symmetric, so the tie does not go to convenience.
  //
  // The reason names the way out, because this message is what someone reads
  // when a routine just told them it could not reach a source it should have.
  return {
    dangerous: true,
    reason:
      "the name says neither read nor write — declare it in this MCP's " +
      "read_only_tools (or have the server send annotations.readOnlyHint)",
  };
}
