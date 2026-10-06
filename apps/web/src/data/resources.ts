// Resources screen calls: skills, MCP servers and variables. Each returns undefined (and shows a notice) on failure.
import type { McpServerStatus, SecretInfo, SkillInfo } from "@apx/protocol";
import { t } from "../i18n/index.ts";
import { client } from "./client.ts";
import { notify } from "./notices.ts";

const errText = (e: unknown) => (e instanceof Error ? e.message : String(e));

async function attempt<T>(work: () => Promise<T>): Promise<T | undefined> {
  try {
    return await work();
  } catch (e) {
    notify(t("res.error", { error: errText(e) }));
    return undefined;
  }
}

const scoped = (project: string | undefined) => (project ? { project } : {});

export const listSkills = (project?: string) =>
  attempt(async () => (await client.call("skills.list", scoped(project))).skills);

export const getSkill = (name: string, project?: string) =>
  attempt(() => client.call("skills.get", { name, ...scoped(project) }));

export const saveSkill = (name: string, target: "global" | "project", content: string, project?: string) =>
  attempt(async () => (await client.call("skills.save", { name, target, content, ...scoped(project) })).skill);

export const toggleSkill = (name: string, on: boolean, project?: string) =>
  attempt(() => client.call("skills.toggle", { name, on, ...scoped(project) }));

export const listMcp = (project?: string) =>
  attempt(async () => (await client.call("mcp.list", scoped(project))).servers);

export const toggleMcp = (project: string, server: string, on: boolean) =>
  attempt(async () => (await client.call("mcp.toggle", { project, server, on })).servers);

export const trustMcp = (project: string | undefined, server: string, trusted: boolean) =>
  attempt(async () => (await client.call("mcp.trust", { ...scoped(project), server, trusted })).server);

export const testMcp = (s: McpServerStatus) =>
  attempt(() =>
    client.call("mcp.test", { scope: s.scope, server: s.name, ...(s.project_id ? { project: s.project_id } : {}) }),
  );

export type McpDraft = {
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  url?: string;
  headers?: Record<string, string>;
  enabled?: boolean;
};

/** Adds or replaces one of the owner's servers (or, with `project`, one in its .apc/mcps.json); null removes it. */
export const setMcp = (name: string, server: McpDraft | null, project?: string) =>
  attempt(async () => (await client.call("mcp.set", { name, server, ...(project ? { project } : {}) })).servers);

export const listSecrets = () => attempt(async () => (await client.call("secrets.list", {})).secrets);

/** Stores (or with null removes) a variable; its value never comes back to the panel. */
/** `project`: that project's own value, over the global one there. */
export const setSecret = (name: string, value: string | null, project?: string) =>
  attempt(() => client.call("secrets.set", { name, value, ...(project ? { project } : {}) }));

export type { McpServerStatus, SecretInfo, SkillInfo };

export const getInheritance = (project: string) => attempt(() => client.call("resources.inheritance", { project }));

export const setInheritance = (project: string, kind: "skills" | "mcp", on: boolean) =>
  attempt(() => client.call("resources.inherit", { project, kind, on }));

export const listApprovals = () => attempt(async () => (await client.call("tools.approvals", {})).approvals);
export const revokeApproval = (key: string, thread?: string) =>
  attempt(() => client.call("tools.revoke", { key, ...(thread ? { thread } : {}) }));
export const mcpPermissions = (s: McpServerStatus, project?: string) =>
  attempt(async () => (await client.call("mcp.tools", { scope: s.scope, server: s.name, ...scoped(project) })).tools);
export const approveMcpTool = (s: McpServerStatus, tool: string, project?: string) =>
  attempt(() => client.call("mcp.approveTool", { scope: s.scope, server: s.name, tool, ...scoped(project) }));
