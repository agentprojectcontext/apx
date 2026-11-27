import type { Confirm } from "../tools/types.ts";
import type { McpDef } from "./config.ts";

/** A project's own read-only claim does not remove the owner's approval boundary. */
export function mcpConfirm(readOnly: boolean, destructive: boolean | undefined, scope: McpDef["scope"]): Confirm {
  if (readOnly) return scope === "global" ? "never" : "untrusted";
  return destructive === false ? "untrusted" : "ask";
}

/** MCP tool names become `mcp_<server>_<tool>`, within what every model accepts. */
export const toolName = (server: string, tool: string) =>
  `mcp_${server}_${tool}`.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 64);
