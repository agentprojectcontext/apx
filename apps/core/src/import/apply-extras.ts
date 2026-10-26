// A project's MCP servers, memory notes, open tasks and automations brought from Claude Code or Codex, through APX's
// own methods (the same checks as the owner's). Each is brought once; a server whose file holds a credential is only
// reported: its value never goes to the project's file.
import type { Store } from "../domain/store.ts";
import { redactSecrets } from "../redact-secrets.ts";
import type { InternalCall } from "../rpc/internal.ts";
import type { Extras } from "./native-extras.ts";
import type { NativeEngine } from "./native-sessions.ts";

export type ExtrasResult = {
  mcps: { added: string[]; existing: string[]; need_values: Array<{ name: string; keys: string[] }> };
  notes: number;
  tasks: number;
  /** Brought turned off: the engine may still run them, and twice is never wanted. */
  routines: string[];
  /** What APX refused (a note that still reads as a credential, a task or routine it could not take), with why. */
  skipped: string[];
};

const OWNER = { actor: "human" } as const;
const serverName = (name: string) =>
  name
    .replace(/[^a-zA-Z0-9_-]+/g, "-")
    .replace(/^[^a-zA-Z0-9]+/, "")
    .slice(0, 41) || "server";

export async function applyExtras(
  store: Store,
  call: InternalCall,
  o: {
    engine: NativeEngine;
    project_id: string;
    /** The project's orchestrator (or the super-agent): it runs the routines. */
    head: string;
    extras: Extras;
    /** The chat a session became, and the agent answering there. */
    chatOf(session: string): { title: string; agent: string } | undefined;
  },
): Promise<ExtrasResult> {
  const out: ExtrasResult = {
    mcps: { added: [], existing: [], need_values: [] },
    notes: 0,
    tasks: 0,
    routines: [],
    skipped: [],
  };
  const done = (key: string) => `native_extra:${o.engine}:${o.project_id}:${key}`;
  /** Brings one thing once; one APX refuses is noted and left for a later import, never stopping the rest. */
  const once = async (key: string, what: string, bring: () => Promise<unknown>) => {
    if (store.settings.get(done(key))) return false;
    try {
      await bring();
    } catch (err) {
      out.skipped.push(`${what}: ${err instanceof Error ? err.message : String(err)}`);
      return false;
    }
    store.settings.set(done(key), new Date().toISOString());
    return true;
  };

  const known = new Set((await call("mcp.list", { project: o.project_id }, OWNER)).servers.map((s) => s.name));
  for (const m of o.extras.mcps) {
    const name = serverName(m.name);
    if (known.has(name) || known.has(m.name)) out.mcps.existing.push(name);
    else if (m.secrets.length) out.mcps.need_values.push({ name, keys: m.secrets });
    else if (
      await once(`mcp:${name}`, `server ${name}`, () =>
        call("mcp.set", { name, project: o.project_id, server: m.server }, OWNER),
      )
    )
      out.mcps.added.push(name);
  }
  for (const n of o.extras.notes)
    if (
      await once(n.key, `note "${n.text.slice(0, 40)}…"`, () =>
        call(
          "memory.add",
          { text: redactSecrets(n.text).slice(0, 2000), scope: "project", project: o.project_id },
          OWNER,
        ),
      )
    )
      out.notes++;
  for (const t of o.extras.tasks) {
    const chat = o.chatOf(t.session);
    const assignee = chat && store.agents.get(chat.agent)?.project_id === o.project_id ? chat.agent : undefined;
    const description = [t.description, chat ? `From the chat "${chat.title}".` : ""].filter(Boolean).join("\n\n");
    const params = { title: t.title, description: description.slice(0, 10_000), project: o.project_id };
    if (
      await once(t.key, `task "${t.title}"`, () =>
        call("tasks.create", assignee ? { ...params, assignee } : params, OWNER),
      )
    )
      out.tasks++;
  }
  for (const r of o.extras.routines) {
    const routine = {
      name: r.name.slice(0, 120),
      agent: o.head,
      project: o.project_id,
      schedule: { kind: "cron" as const, cron: r.cron },
      prompt: r.prompt.slice(0, 20_000),
      enabled: false,
    };
    if (await once(r.key, `routine "${r.name}"`, () => call("routines.set", routine, OWNER))) out.routines.push(r.name);
  }
  return out;
}
