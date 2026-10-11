// Human-in-the-loop confirmation system.
//
// Public surface:
//   getConfirmationStore()          shared SQLite-backed pending store
//   buildConfirmDescription(t, a)   human-readable action summary
//   isConfirmationRequired(err)     true when a tool threw requires_confirmation:
//
// Adapters (one per channel type) live under ./adapters/.

export { getConfirmationStore, ConfirmationPendingStore } from "./pending-store.js";

/**
 * Returns true when `error` was thrown by createPermissionGuard() to signal
 * that this tool call needs explicit user approval before proceeding.
 */
export function isConfirmationRequired(error) {
  return (
    error != null &&
    typeof error.message === "string" &&
    error.message.startsWith("requires_confirmation:")
  );
}

/**
 * Build a short, human-readable description of the action being confirmed.
 * Shown in all confirmation channels (terminal prompt, Telegram message, web dialog).
 */
export function buildConfirmDescription(tool, args) {
  const text = (s, max = 150) => String(s || "").slice(0, max);
  // The record being touched: its id, and what it is about when the tool
  // looked it up first (`subject`), so the owner knows WHICH task this is.
  const record = (id, subject) => `${id || "?"}${subject ? ` "${text(subject, 60)}"` : ""}`;
  // What an edit changes, field by field with the new value. "Edit task
  // t_ab12cd" alone does not tell anyone what they are approving.
  const changeOf = (k, v) => {
    if (v === null || v === "") return `${k} cleared`;
    if (Array.isArray(v)) return `${k} → ${text(v.map((x) => (x && typeof x === "object" ? x.task ?? "?" : x)).join(", "), 80) || "(none)"}`;
    if (typeof v === "object") return `${k} → ${text(Object.values(v).filter((x) => x != null && x !== "").join(", "), 80)}`;
    return `${k} → "${text(v, 80)}"`;
  };
  const changes = (a, addressing) =>
    Object.entries(a || {})
      .filter(([k, v]) => !addressing.includes(k) && v !== undefined)
      .map(([k, v]) => changeOf(k, v))
      .join(", ");
  const move = (a) => {
    if (a.action !== "status") return a.action === "done" ? "mark done" : a.action || "?";
    return a.from ? `move from ${a.from} to ${a.status || "?"}` : `move to ${a.status || "?"}`;
  };
  const resolve = (a) =>
    a.action === "renegotiate"
      ? `renegotiate${a.from ? ` from ${a.from}` : ""} to ${a.due || "?"}`
      : a.action || "?";

  const builders = {
    send_telegram: (a) => `Send Telegram message: "${text(a.text)}"`,
    run_shell:     (a) => `Run shell command: \`${text(a.command)}\``,
    write_file:    (a) => `Write file: ${a.path || a.file || "(no path)"}`,
    edit_file:     (a) => `Edit file: ${a.path || a.file || "(no path)"}`,
    create_task:   (a) => `Create task: "${a.title || a.name || "?"}"`,
    update_task:   (a) => `Edit task ${record(a.task, a.subject)}: ${changes(a, ["task", "project", "subject"]) || "(nothing)"}`,
    complete_task: (a) => `Task ${record(a.task, a.subject)}: ${move(a)}`,
    comment_task:  (a) => `Comment on task ${a.task || "?"}: "${text(a.text, 80)}"`,
    update_commitment: (a) => `Edit commitment ${record(a.commitment, a.subject)}: ${changes(a, ["commitment", "project", "subject"]) || "(nothing)"}`,
    mark_commitment:   (a) => `Commitment ${record(a.commitment, a.subject)}: ${resolve(a)}`,
    add_project:   (a) => `Add project: ${a.path || a.name || "?"}`,
    set_identity:  (a) => `Change agent identity to: "${a.name || "?"}"`,
    call_runtime:  (a) => `Call runtime: ${a.runtime || a.name || "?"}`,
    // Only reachable under `permiso`, where every tool not on the allowlist
    // asks. "Run tool: `call_mcp`" named the door, not what was going through
    // it — and one call_mcp is every tool of every registered server.
    call_mcp:      (a) => `Call MCP tool: ${a.mcp || "?"} → ${a.tool || "?"}`,
  };

  const fn = builders[tool];
  return fn ? fn(args) : `Run tool: \`${tool}\``;
}
