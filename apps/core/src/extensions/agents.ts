// The ready-made agents an extension brings, once the owner adds them: each becomes one of their agents (global, as
// any agent made by hand), remembered by the extension so that removing it archives them too (DECISIONS.md#d-254).
import type { Agent } from "@apx/protocol";
import { contactAgentOf } from "../channels/types.ts";
import { publicAgent } from "../domain/agents.ts";
import type { ExtensionRecord } from "../domain/extensions.ts";
import type { Store } from "../domain/store.ts";
import { notFound } from "../errors.ts";

/** A free agent id from its name: lowercase words with "-", "-2", "-3"… when one is taken (archived ones count). */
function freeId(store: Store, name: string): string {
  const base =
    name
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^[^a-z]+|-+$/g, "")
      .slice(0, 48) || "agent";
  let id = base;
  for (let n = 2; store.agents.get(id); n++) id = `${base}-${n}`;
  return id;
}

/** The agents added from it that are still on the owner's team. */
export function addedAgents(store: Store, e: Pick<ExtensionRecord, "added_agents">) {
  return Object.entries(e.added_agents).flatMap(([agent, id]) => {
    const a = store.agents.active(id) ? store.agents.get(id) : undefined;
    return a ? [{ agent, id: a.id, name: a.name }] : [];
  });
}

/** Adds one of its agents to the owner's team; one already there is answered as it is. */
export function addExtensionAgent(store: Store, e: ExtensionRecord, agent: string): Agent {
  const a = e.manifest.agents.find((x) => x.id === agent);
  if (!a) throw notFound(`agent ${agent} of ${e.id}`);
  const had = e.added_agents[agent];
  const there = had && store.agents.active(had) ? store.agents.get(had) : undefined;
  if (there) return publicAgent(there);
  const id = freeId(store, a.name);
  store.agents.upsert({
    id,
    name: a.name,
    role: "",
    ...(a.description ? { description: a.description } : {}),
    kind: "agent",
    browser_profile: "shared",
    prompt: a.prompt,
  });
  store.extensions.addAgent(e.id, agent, id);
  const made = store.agents.get(id);
  if (!made) throw notFound(`agent ${id}`);
  return publicAgent(made);
}

/**
 * Archives the agents added from it, as the team's own Archive would (the owner can bring each back or delete it for
 * good). One that answers a channel stays: a channel would answer as nobody.
 */
export function archiveExtensionAgents(store: Store, e: ExtensionRecord): { archived: string[]; kept: string[] } {
  const channels = store.settings.read("channels");
  const out = { archived: [] as string[], kept: [] as string[] };
  for (const { id, name } of addedAgents(store, e)) {
    if (channels.some((c) => c.agent_id === id || contactAgentOf(c) === id)) out.kept.push(name);
    else {
      store.agents.archive(id);
      out.archived.push(name);
    }
  }
  return out;
}
