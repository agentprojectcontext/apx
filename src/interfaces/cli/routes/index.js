// Command registry: name (and alias) -> lazy loader for its route module.
//
// Lazy on purpose. cli/index.js used to eagerly import 165 symbols from 38
// command modules just to reach a 457-line switch, so `apx status` paid to
// load the Electron desktop wiring, the MCP runner and the session scanner.
// Now one command loads one module.
//
// Aliases live next to their command (see the `aliases` export in each route
// module); this map is generated from them.
export const ROUTES = Object.freeze({
  "init": () => import("./init.js"),
  "project": () => import("./project.js"),
  "agent": () => import("./agent.js"),
  "memory": () => import("./memory.js"),
  "session": () => import("./session.js"),
  "sessions": () => import("./sessions.js"),
  "mcp": () => import("./mcp.js"),
  "obsidian": () => import("./obsidian.js"),
  "daemon": () => import("./daemon.js"),
  "pair": () => import("./pair.js"),
  "telegram": () => import("./telegram.js"),
  "messages": () => import("./messages.js"),
  "log": () => import("./log.js"),
  "logs": () => import("./log.js"),
  "exec": () => import("./exec.js"),
  "acp": () => import("./acp.js"),
  "search": () => import("./search.js"),
  "chat": () => import("./chat.js"),
  "code": () => import("./code.js"),
  "conversations": () => import("./conversations.js"),
  "conv": () => import("./conversations.js"),
  "run": () => import("./run.js"),
  "env": () => import("./env.js"),
  "send": () => import("./send.js"),
  "connections": () => import("./connections.js"),
  "config": () => import("./config.js"),
  "permission": () => import("./permission.js"),
  "model": () => import("./model.js"),
  "plugins": () => import("./plugins.js"),
  "plugin": () => import("./plugins.js"),
  "routine": () => import("./routine.js"),
  "routines": () => import("./routine.js"),
  "artifact": () => import("./artifact.js"),
  "artifacts": () => import("./artifact.js"),
  "task": () => import("./task.js"),
  "tasks": () => import("./task.js"),
  "panel": () => import("./panel.js"),
  "profile": () => import("./profile.js"),
  "profiles": () => import("./profile.js"),
  "nudge": () => import("./nudge.js"),
  "nudges": () => import("./nudge.js"),
  "command": () => import("./command.js"),
  "commands": () => import("./command.js"),
  "org": () => import("./org.js"),
  "organization": () => import("./org.js"),
  "skills": () => import("./skills.js"),
  "identity": () => import("./identity.js"),
  "status": () => import("./status.js"),
  "setup": () => import("./setup.js"),
  "install": () => import("./setup.js"),
  "update": () => import("./update.js"),
  "upgrade": () => import("./update.js"),
  "restart": () => import("./restart.js"),
  "overlay": () => import("./overlay.js"),
  "desktop": () => import("./desktop.js"),
  "voice": () => import("./voice.js"),
});

export function resolveRoute(cmd) {
  return ROUTES[cmd] || null;
}

export const COMMAND_NAMES = Object.freeze(Object.keys(ROUTES));
