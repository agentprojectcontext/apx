// Resources screen calls: skills, MCP servers and variables. Each returns undefined (and shows a notice) on failure.
import type { McpServerStatus, SecretInfo, SkillCandidate, SkillImportSource, SkillInfo } from "@apx/protocol";
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

/** Reads a folder, zip or repository and lists the skills in it (nothing is kept). */
export const previewSkillImport = (source: SkillImportSource, project?: string) =>
  attempt(
    async () =>
      (await client.call("skills.preview", { source, target: project ? "project" : "global", ...scoped(project) }))
        .candidates,
  );

/** Copies the picked skills (by candidate id) into APX's skills, or the project's with `project`. */
export const importSkills = (source: SkillImportSource, pick: string[], replace: boolean, project?: string) =>
  attempt(() =>
    client.call("skills.import", { source, pick, replace, target: project ? "project" : "global", ...scoped(project) }),
  );

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

export const signInMcp = (s: McpServerStatus) =>
  attempt(
    async () =>
      (
        await client.call("mcp.signIn", {
          scope: s.scope,
          server: s.name,
          ...(s.project_id ? { project: s.project_id } : {}),
        })
      ).server,
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

export type { McpServerStatus, SecretInfo, SkillCandidate, SkillImportSource, SkillInfo };

export const getInheritance = (project: string) => attempt(() => client.call("resources.inheritance", { project }));

export const setInheritance = (project: string, kind: "skills" | "mcp", on: boolean) =>
  attempt(() => client.call("resources.inherit", { project, kind, on }));

export const listApprovals = () => attempt(async () => (await client.call("tools.approvals", {})).approvals);
export const revokeApproval = (key: string, thread?: string, agent?: string) =>
  attempt(() => client.call("tools.revoke", { key, ...(thread ? { thread } : {}), ...(agent ? { agent } : {}) }));
/** Its tools and their permissions, or why the server did not start (`error`). */
export const mcpPermissions = (s: McpServerStatus, project?: string) =>
  attempt(() => client.call("mcp.tools", { scope: s.scope, server: s.name, ...scoped(project) }));
export const approveMcpTool = (s: McpServerStatus, tool: string, project?: string) =>
  attempt(() => client.call("mcp.approveTool", { scope: s.scope, server: s.name, tool, ...scoped(project) }));

/** Uses the same current contracts as individual toggles; a failure stops the batch and shows a notice. */
export const setMcpToolMode = (s: McpServerStatus, mode: "ask" | "all", project?: string) =>
  attempt(async () => {
    const { tools, error } = await client.call("mcp.tools", { scope: s.scope, server: s.name, ...scoped(project) });
    if (error) throw new Error(error);
    for (const tool of tools) {
      if (mode === "all" && !tool.approved)
        await client.call("mcp.approveTool", { scope: s.scope, server: s.name, tool: tool.name, ...scoped(project) });
      if (mode === "ask" && tool.approved) await client.call("tools.revoke", { key: tool.key });
    }
    return { ok: true };
  });
