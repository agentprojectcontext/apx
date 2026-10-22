// Small labels shared by the Resources tabs.
import type { McpServerStatus, SkillInfo } from "@apx/protocol";
import type { MessageKey, T } from "../i18n/index.ts";

/** The agent apps a skill can live in; APX's own, the owner's, a project's and extensions' count as APX. */
export const SKILL_ENGINES = ["apx", "claude", "codex", "cursor", "agents"] as const;
export type SkillEngine = (typeof SKILL_ENGINES)[number];

export const ENGINE_LABEL: Record<SkillEngine, string> = {
  apx: "APX",
  claude: "Claude",
  codex: "Codex",
  cursor: "Cursor",
  agents: "Agents",
};

export const engineOf = (source: SkillInfo["source"]): SkillEngine =>
  source === "owner" || source === "project" || source === "extension" ? "apx" : source;

/** Whether a skill, or one of its copies, lives in one of these engines (none picked: every skill). */
export const inEngines = (s: SkillInfo, picked: ReadonlySet<SkillEngine>) =>
  !picked.size || [s.source, ...s.copies.map((c) => c.source)].some((src) => picked.has(engineOf(src)));

/** The picked engines a skill is in only through a copy agents do not use. */
export const unusedIn = (s: SkillInfo, picked: ReadonlySet<SkillEngine> | undefined): SkillEngine[] =>
  picked?.size
    ? [...new Set(s.copies.map((c) => engineOf(c.source)))].filter((e) => picked.has(e) && e !== engineOf(s.source))
    : [];

/** Where a skill comes from, when it is not the owner's or the project's own. */
export function sourceTag(s: Pick<SkillInfo, "source">, t: T): string | undefined {
  if (s.source === "apx") return "APX";
  if (s.source === "extension") return t("res.source.extension");
  if (s.source === "owner" || s.source === "project") return undefined;
  return ENGINE_LABEL[s.source];
}

/** A copy's place: its app, or APX for the owner's and a project's folders. */
export const copyTag = (c: SkillInfo["copies"][number], t: T) => sourceTag(c, t) ?? "APX";

export const STATUS_KEY: Record<McpServerStatus["status"], MessageKey> = {
  ready: "mcp.status.ready",
  off: "mcp.status.off",
  starting: "mcp.status.starting",
  disabled: "mcp.status.disabled",
  "needs-approval": "mcp.status.needsApproval",
  "needs-sign-in": "mcp.status.needsSignIn",
  error: "mcp.status.error",
};

/** A server that starts when an agent first uses it ("off" while enabled) is ready, not off: a ring, not grey. */
export function mcpDot(s: McpServerStatus): "on" | "idle" | "off" | "error" | "warning" {
  if (s.off_here || s.status === "disabled") return "off";
  if (s.status === "error") return "error";
  if (s.status === "needs-approval" || s.status === "needs-sign-in") return "warning";
  if (s.status === "ready") return "on";
  return s.status === "off" || s.status === "starting" ? "idle" : "off";
}
