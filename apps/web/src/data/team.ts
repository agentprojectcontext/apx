// Team screen writes: who an agent reports to, and installing agent templates into a project.
import type { AgentTemplate, Params, Result, TeamTemplate } from "@apx/protocol";
import { t } from "../i18n/index.ts";
import { client } from "./client.ts";
import { notify } from "./notices.ts";
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
export async function installTemplates(
  projectId: string,
  templates: string[],
  hangUnder: string | undefined,
): Promise<{ installed: number; routines: number; skipped: Array<{ template: string; reason: string }> } | undefined> {
  try {
    const r = await client.call("agents.install", {
      project_id: projectId,
      templates,
      ...(hangUnder ? { hang_under: hangUnder } : {}),
    });
    data.set((s) => ({ agents: { ...s.agents, ...Object.fromEntries(r.installed.map((a) => [a.id, a])) } }));
    if (r.routines.length) void loadRoutines();
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
