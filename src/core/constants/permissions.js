// Permission modes. The value lives in config.super_agent.permission_mode and
// is read by createPermissionGuard (agent/tools/helpers.js).
//
// A project agent may narrow (or widen) it for itself with `Autonomy:` in its
// frontmatter — see normalizeAutonomy below and run-turn.js, which folds the
// agent's answer over the project's before the turn starts. An agent that
// declares nothing inherits, which is the common case and the right default:
// most agents should behave like the machine they run on.
//
//   total      — execute every tool without confirmation.
//   automatico — read-only / safe shell runs directly; destructive,
//                outbound, runtime, MCP, and filesystem-mutating actions
//                require user confirmation via the interface dialog.
//   permiso    — only allowed_tools run directly; everything else requires
//                user confirmation.
export const PERMISSION_MODES = Object.freeze({
  TOTAL: "total",
  AUTOMATICO: "automatico",
  PERMISO: "permiso",
});

export const DEFAULT_PERMISSION_MODE = PERMISSION_MODES.AUTOMATICO;

const AUTONOMY_VALUES = new Set(Object.values(PERMISSION_MODES));

/**
 * A per-agent autonomy value, normalised.
 *
 *   undefined  the caller said nothing — leave whatever is stored alone
 *   null       an explicit clear: inherit from the project
 *   "<mode>"   one of PERMISSION_MODES
 *
 * An unrecognised string returns `undefined` rather than being persisted, so a
 * typo cannot silently WIDEN an agent's autonomy — the one direction where
 * failing open is dangerous.
 */
export function normalizeAutonomy(v) {
  if (v === undefined) return undefined;
  if (v === null || v === "") return null;
  return AUTONOMY_VALUES.has(v) ? v : undefined;
}
