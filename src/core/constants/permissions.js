// Permission modes for the super-agent. The value lives in
// config.super_agent.permission_mode and is read by createPermissionGuard
// (super-agent-tools/helpers.js).
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
