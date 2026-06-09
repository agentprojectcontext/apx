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

  const builders = {
    send_telegram: (a) => `Send Telegram message: "${text(a.text)}"`,
    run_shell:     (a) => `Run shell command: \`${text(a.command)}\``,
    write_file:    (a) => `Write file: ${a.path || a.file || "(no path)"}`,
    edit_file:     (a) => `Edit file: ${a.path || a.file || "(no path)"}`,
    create_task:   (a) => `Create task: "${a.title || a.name || "?"}"`,
    add_project:   (a) => `Add project: ${a.path || a.name || "?"}`,
    set_identity:  (a) => `Change agent identity to: "${a.name || "?"}"`,
    call_runtime:  (a) => `Call runtime: ${a.runtime || a.name || "?"}`,
  };

  const fn = builders[tool];
  return fn ? fn(args) : `Run tool: \`${tool}\``;
}
