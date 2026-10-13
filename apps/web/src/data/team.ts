// Team screen writes: creating and removing agents, who one reports to, and installing templates into a project.
import type { Agent, AgentTemplate, Params, Result, TeamTemplate } from "@apx/protocol";
import { slugOf } from "../common/slug.ts";
import { t } from "../i18n/index.ts";
import { client } from "./client.ts";
import { realProjectId } from "./identity.ts";
import { notify } from "./notices.ts";
import { loadOrg } from "./org.ts";
import { loadRoutines } from "./routines.ts";
import { data } from "./state.ts";

const errText = (e: unknown) => (e instanceof Error ? e.message : String(e));

/** `parent` is a slug of the same project; "" makes the agent report to nobody (a root). */
export async function setAgentParent(agent: string, parent: string): Promise<boolean> {
  try {
    const next = await client.call("agents.update", { agent, parent });
    data.set((s) => ({ agents: { ...s.agents, [next.id]: next } }));
    return true;
  } catch (e) {
    notify(t("error.save", { error: errText(e) }));
    return false;
  }
}

export async function loadTemplates(): Promise<{ teams: TeamTemplate[]; singles: AgentTemplate[] } | undefined> {
  try {
    return await client.call("agents.templates", {});
  } catch (e) {
    notify(t("team.import.error", { error: errText(e) }));
    return undefined;
  }
}

/** Installs and adds the new agents to the panel; returns how many were installed and skipped. */
/** Copies agents of other projects into this one; with `rename`, each copy gets a new free name. */
export async function cloneAgents(
  projectId: string,
  agents: string[],
  rename: boolean,
  hangUnder: string | undefined,
): Promise<{ cloned: number; skipped: Array<{ agent: string; reason: string }> } | undefined> {
  try {
    const project = realProjectId(projectId);
    const r = await client.call("agents.clone", {
      agents,
      rename,
      ...(project ? { project_id: project } : {}),
      ...(hangUnder ? { hang_under: hangUnder } : {}),
    });
    data.set((s) => ({ agents: { ...s.agents, ...Object.fromEntries(r.cloned.map((a) => [a.id, a])) } }));
    return { cloned: r.cloned.length, skipped: r.skipped };
  } catch (e) {
    notify(t("team.import.error", { error: errText(e) }));
    return undefined;
  }
}

export async function installTemplates(
  projectId: string,
  templates: string[],
  hangUnder: string | undefined,
): Promise<{ installed: number; routines: number; skipped: Array<{ template: string; reason: string }> } | undefined> {
  try {
    const project = realProjectId(projectId);
    const r = await client.call("agents.install", {
      ...(project ? { project_id: project } : {}),
      templates,
      ...(hangUnder ? { hang_under: hangUnder } : {}),
    });
    data.set((s) => ({ agents: { ...s.agents, ...Object.fromEntries(r.installed.map((a) => [a.id, a])) } }));
    if (r.routines.length) void loadRoutines();
    // A team with a kind made the project a company: its kind and its areas and roles changed too.
    if (r.project_kind) {
      const { projects, base } = await client.call("projects.list", { include_unregistered: true });
      data.set({ projects, base });
      void loadOrg(projectId);
    }
    return { installed: r.installed.length, routines: r.routines.length, skipped: r.skipped };
  } catch (e) {
    notify(t("team.import.error", { error: errText(e) }));
    return undefined;
  }
}

/** One agent with its prompt (the owner's view); undefined when the core refused. */
export async function getAgent(agent: string): Promise<Result<"agents.get"> | undefined> {
  try {
    return await client.call("agents.get", { agent });
  } catch (e) {
    notify(t("error.load", { error: errText(e) }));
    return undefined;
  }
}

/** APX's own tools an agent's list may name, with their groups (for the agent's editor). */
export async function agentToolCatalog(): Promise<Result<"agents.tools">["tools"] | undefined> {
  try {
    return (await client.call("agents.tools", {})).tools;
  } catch (e) {
    notify(t("error.load", { error: errText(e) }));
    return undefined;
  }
}

/** An agent's runs, newest first; `before` pages back. */
export async function agentRuns(agent: string, before?: string): Promise<Result<"runs.list">> {
  try {
    return await client.call("runs.list", { agent, limit: 30, ...(before ? { before } : {}) });
  } catch (e) {
    notify(t("error.load", { error: errText(e) }));
    return { runs: [], threads: [] };
  }
}

/** Saves what changed in an agent (identity, prompt, parent…); true when the core took it. */
export async function updateAgent(agent: string, fields: Omit<Params<"agents.update">, "agent">): Promise<boolean> {
  try {
    const next = await client.call("agents.update", { agent, ...fields });
    data.set((s) => ({ agents: { ...s.agents, [next.id]: next } }));
    return true;
  } catch (e) {
    notify(t("error.save", { error: errText(e) }));
    return false;
  }
}

/** A new agent: in a project's `.apc/agents/` or, with no project, a global one. Undefined when the core refused. */
export async function createAgent(
  fields: Omit<Params<"agents.create">, "slug" | "role" | "prompt"> & { role?: string; prompt?: string },
): Promise<Agent | undefined> {
  const slug = slugOf(fields.name);
  if (!slug) {
    notify(t("team.new.badName"));
    return undefined;
  }
  try {
    const made = await client.call("agents.create", {
      ...fields,
      slug,
      role: fields.role ?? "",
      prompt: fields.prompt ?? "",
    });
    data.set((s) => ({ agents: { ...s.agents, [made.id]: made } }));
    return made;
  } catch (e) {
    notify(t("error.save", { error: errText(e) }));
    return undefined;
  }
}

/** Archived agents, every project's: the owner brings one back or deletes it for good. */
export async function loadArchivedAgents(): Promise<Agent[]> {
  try {
    return (await client.call("agents.archived", {})).agents;
  } catch (e) {
    notify(t("error.load", { error: errText(e) }));
    return [];
  }
}

async function reloadAgents(): Promise<void> {
  const { agents } = await client.call("agents.list", {});
  data.set({ agents: Object.fromEntries(agents.map((a) => [a.id, a])) });
}

/** An archived agent back on its team (a project agent's file returns to .apc/agents/). */
export async function restoreAgent(agent: Agent): Promise<boolean> {
  try {
    await client.call("agents.restore", { agent: agent.id });
    await reloadAgents();
    return true;
  } catch (e) {
    notify(t("error.save", { error: errText(e) }));
    return false;
  }
}

/** An archived agent deleted for good: its file and its own notes go; its chats keep its name. */
export async function deleteAgentForGood(agent: Agent): Promise<boolean> {
  try {
    await client.call("agents.delete", { agent: agent.id });
    return true;
  } catch (e) {
    notify(t("error.save", { error: errText(e) }));
    return false;
  }
}

/** Removes an agent (its file is archived, its chats stay); its reports move up to its own parent. */
export async function archiveAgent(agent: Agent): Promise<boolean> {
  try {
    await client.call("agents.archive", { agent: agent.id });
    const { agents } = await client.call("agents.list", {});
    data.set({ agents: Object.fromEntries(agents.map((a) => [a.id, a])) });
    return true;
  } catch (e) {
    notify(t("error.save", { error: errText(e) }));
    return false;
  }
}
