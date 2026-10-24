// apx_settings, the owner's team and its work: agents beyond what agent_set does (archived ones, copies, templates,
// one agent's limits), routines, agent profiles, tasks, chats and imported sessions. A chat's write policy stays the
// owner's, like an agent's autonomy (DECISIONS.md#d-060).
import { readTemplates, singlesOf } from "../apc/templates.ts";
import { activeProfile, listProfiles, textIn } from "../engine/profiles.ts";
import { computerApproval } from "../environments/computer.ts";
import { inlineName } from "./result.ts";
import { agentName, ownersField, type Params, projectName, quoted, type Setting, str } from "./settings-kit.ts";

const AUTONOMY = "how far agents may act stays the owner's (DECISIONS.md#d-060)";
const names = (store: Parameters<typeof agentName>[0], ids: unknown) =>
  (Array.isArray(ids) ? ids : []).map((a) => agentName(store, a)).join(", ");

/** Whether an agent may use the isolated computer for good: the agent's own Computer settings page. */
const mayUseComputer = (store: Parameters<typeof agentName>[0], agent: string) =>
  store.approvals.allows(computerApproval, undefined, agent);

export const TEAM: Readonly<Record<string, Setting>> = {
  "environments.status": {
    does: "which agents may use the isolated Linux computer (apart from this Mac, one screen each) and their screens",
    read: (_p, { store }) => {
      const screens = store.settings.read("computer_screens");
      const allowed = store.agents.list().filter((a) => mayUseComputer(store, a.id));
      const lines = allowed.map(
        (a) => `- ${inlineName(a.name)} [${a.id}]${screens[a.id] ? `, screen ${screens[a.id]}` : ""}`,
      );
      return [
        lines.length ? "May use the computer:" : "No agent may use the computer yet.",
        ...lines,
        "Each agent's card and its settings (Computer page) show it; the owner watches the screens in Computers.",
      ].join("\n");
    },
  },
  "environments.permit": {
    does: "let an agent use the isolated computer for good, or take it away (agent, on)",
    named: ["agent"],
    says: (p, { store }) =>
      p.on
        ? `Let ${agentName(store, p.agent)} use the isolated computer`
        : `Take the isolated computer away from ${agentName(store, p.agent)}`,
    now: (p, { store }) =>
      store.agents.get(str(p.agent)) ? { agent: p.agent, on: mayUseComputer(store, str(p.agent)) } : undefined,
    words: { on: (v) => (v ? "It starts its own screen when it needs one" : "Its grants for single chats end too") },
  },
  "agents.archived": {
    does: "the archived agents, to bring back or delete for good",
    read: (_p, { store }) =>
      store.agents
        .archived()
        .map((a) => `- ${inlineName(a.name)} [${a.id}] (${projectName(store, a.project_id)})`)
        .join("\n") || "no archived agents.",
  },
  "agents.templates": {
    does: "the agents APX offers to add to a project, by template id",
    read: (_p, { templates }) =>
      singlesOf(readTemplates(templates).files)
        .map(
          (t) =>
            `- ${t.id}: ${inlineName(t.name)}, ${t.role}${t.description ? `: ${t.description.slice(0, 120)}` : ""}`,
        )
        .join("\n") || "no templates.",
  },
  "agents.install": {
    does: "add agents from templates (ids, agents.templates) to a project (project_id; none: the base), under an agent (hang_under)",
    named: ["templates", "project_id"],
    says: (p, { store }) =>
      `Add ${(p.templates as string[] | undefined)?.join(", ") ?? ""} to ${projectName(store, p.project_id)}`,
  },
  "agents.clone": {
    does: "copy agents (ids) into a project (project_id; none: the base), renamed if taken (rename), under an agent (hang_under)",
    named: ["agents", "project_id"],
    says: (p, { store }) => `Copy ${names(store, p.agents)} into ${projectName(store, p.project_id)}`,
  },
  "agents.restore": {
    does: "bring back an archived agent (agent)",
    named: ["agent"],
    says: (p, { store }) => `Bring back the archived agent ${agentName(store, p.agent)}`,
  },
  "agents.delete": {
    does: "delete an archived agent for good, with its notes (agent)",
    named: ["agent"],
    says: (p, { store }) => `Delete for good the archived agent ${agentName(store, p.agent)} and its notes`,
  },
  "agents.set_agent_limits": {
    does: "how far one agent may go on its own (agent; limits runs/tokens, null: the shared limits)",
    says: (p, { store }) => `Change how far ${agentName(store, p.agent)} may go on its own`,
    now: (p, { store }) => ({
      agent: p.agent,
      limits: store.settings.read("agent_limits").agents?.[str(p.agent)] ?? null,
    }),
  },
  "routines.remove": {
    does: "delete a routine for good (routine: its id, routine_list)",
    named: ["routine"],
    says: (p, { store }) =>
      `Delete the routine ${inlineName(store.routines.get(str(p.routine))?.name ?? str(p.routine))}`,
  },
  "profiles.list": {
    does: "the agent profiles that give the super-agent a line of work, the running one and its values",
    read: (_p, { store, profiles }) => {
      const active = activeProfile(store);
      return (
        listProfiles(profiles)
          .map((m) => {
            const on = m.id === active.id ? `, running with ${JSON.stringify(active.values)}` : "";
            const fields = m.settings.map((f) => f.key).join(", ");
            return `- ${m.id}: ${inlineName(textIn(m.name, "en"))}${on}${fields ? `; values: ${fields}` : ""}: ${textIn(m.description, "en").slice(0, 160)}`;
          })
          .join("\n") || "no agent profiles."
      );
    },
  },
  "profiles.set": {
    does: "run an agent profile (id, and values; null: none), turning its routines on and the previous one's off",
    says: (p, { profiles }) => {
      const m = listProfiles(profiles).find((x) => x.id === p.id);
      return p.id
        ? `Run the agent profile ${inlineName(m ? textIn(m.name, "en") : str(p.id))}`
        : "Stop the running agent profile";
    },
    now: (_p, { store }) => activeProfile(store),
    keep: (p, { store }) => {
      const active = activeProfile(store);
      return p.id === active.id ? { ...p, values: { ...active.values, ...(p.values as Params | undefined) } } : p;
    },
  },
  "profiles.remove": {
    does: "remove an installed agent profile (id); APX's own stay",
    named: ["id"],
    says: (p) => `Remove the agent profile ${str(p.id)}`,
  },
  "profiles.restore": {
    does: "put back the default prompt of an agent profile's routine (routine)",
    named: ["routine"],
    says: (p, { store }) =>
      `Put back the default prompt of the routine ${inlineName(store.routines.get(str(p.routine))?.name ?? str(p.routine))}`,
  },
  "tasks.delete": {
    does: "delete a task for good, with its history and its chat (task)",
    named: ["task"],
    says: (p, { store }) =>
      `Delete for good the task ${quoted(store.tasks.get(str(p.task))?.title ?? str(p.task), 80)}`,
  },
  "threads.update": {
    does: "rename, pin or archive a chat (thread, and only what changes: title, pinned, archived)",
    says: (p, { store }) => `Change the chat ${quoted(store.threads.get(str(p.thread))?.title ?? str(p.thread), 80)}`,
    refuse: (p, { store }) => {
      const t = store.threads.get(str(p.thread));
      return ownersField(p, t ? { write: t.write } : undefined, "write", AUTONOMY);
    },
    now: (p, { store }) => {
      const t = store.threads.get(str(p.thread));
      return t ? { thread: t.id, title: t.title, pinned: t.pinned ?? false, archived: t.archived ?? false } : undefined;
    },
  },
  "sessions.import": {
    does: "bring Claude Code or Codex sessions of a folder (engine, cwd) into APX as chats of its project",
    named: ["engine", "cwd"],
    says: (p) => `Bring the ${str(p.engine)} sessions of ${str(p.cwd)} into APX`,
  },
  "sessions.adopt": {
    does: "hand an imported chat (thread) to another agent of its project (agent)",
    named: ["thread", "agent"],
    says: (p, { store }) =>
      `Hand the chat ${quoted(store.threads.get(str(p.thread))?.title ?? str(p.thread), 80)} to ${agentName(store, p.agent)}`,
  },
  "sessions.digest": {
    does: "summarize an imported chat (thread) and keep the summary on it",
    named: ["thread"],
    says: (p, { store }) =>
      `Summarize the chat ${quoted(store.threads.get(str(p.thread))?.title ?? str(p.thread), 80)}`,
  },
};
