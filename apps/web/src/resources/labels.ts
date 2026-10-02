// Small labels shared by the Resources tabs.
import type { McpServerStatus, SkillInfo } from "@apx/protocol";
import type { MessageKey, T } from "../i18n/index.ts";

/** Where a skill comes from, when it is not the owner's or the project's own. */
export function sourceTag(s: SkillInfo, t: T): string | undefined {
  if (s.source === "extension") return t("res.source.extension");
  if (s.source === "claude") return "Claude";
  return undefined;
}

export const STATUS_KEY: Record<McpServerStatus["status"], MessageKey> = {
  ready: "mcp.status.ready",
  off: "mcp.status.off",
  starting: "mcp.status.starting",
  disabled: "mcp.status.disabled",
  "needs-approval": "mcp.status.needsApproval",
  error: "mcp.status.error",
};

export function mcpDot(s: McpServerStatus): "on" | "off" | "error" | "warning" {
  if (s.off_here || s.status === "disabled") return "off";
  if (s.status === "error") return "error";
  if (s.status === "needs-approval") return "warning";
  return s.status === "ready" ? "on" : "off";
}
