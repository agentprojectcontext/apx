// apx2 memory: the notes agents keep between threads, as the owner sees and manages them.
import type { Memory, MemoryScope } from "@apx/protocol";
import type { ApxClient } from "@apx/protocol/client";

const SCOPES = ["global", "project", "agent"] as const;

const where = (m: Memory) =>
  m.scope === "project" ? `project:${m.project_id}` : m.scope === "agent" ? `agent:${m.agent_id}` : "global";

export async function memory(
  client: ApxClient,
  [sub, ...rest]: string[],
  opts: { project?: string | undefined; agent?: string | undefined; json?: boolean | undefined },
): Promise<void> {
  switch (sub) {
    case "add": {
      const [scopeArg, ...words] = rest;
      const scope = SCOPES.includes(scopeArg as MemoryScope) ? (scopeArg as MemoryScope) : undefined;
      const text = (scope ? words : rest).join(" ").trim();
      if (!text) throw new Error('usage: apx2 memory add [global|project|agent] "text" [--project p] [--agent a]');
      const resolved = scope ?? (opts.agent ? "agent" : opts.project ? "project" : "global");
      const m = await client.call("memory.add", {
        text,
        scope: resolved,
        ...(opts.project ? { project: opts.project } : {}),
        ...(opts.agent ? { agent: opts.agent } : {}),
      });
      console.log(`${m.id}  ${where(m)}`);
      return;
    }
    case "rm":
    case "remove": {
      for (const id of rest) {
        const r = await client.call("memory.remove", { id });
        console.log(`${id}  ${r.removed ? "removed" : "not found"}`);
      }
      return;
    }
    default: {
      // `apx2 memory`, `apx2 memory list`, or `apx2 memory search <words>`.
      const query = sub === "search" ? rest.join(" ") : sub && sub !== "list" ? [sub, ...rest].join(" ") : undefined;
      const r = await client.call("memory.list", {
        ...(query ? { query } : {}),
        ...(opts.project ? { project: opts.project } : {}),
        ...(opts.agent ? { agent: opts.agent } : {}),
      });
      if (opts.json) {
        console.log(JSON.stringify(r.memories, null, 2));
        return;
      }
      for (const m of r.memories)
        console.log(
          `${m.id}  ${where(m).padEnd(24)} ${m.source === "owner" ? "you " : (m.author_agent ?? "agent").slice(0, 4).padEnd(4)}  ${m.text}`,
        );
      if (!r.memories.length) console.log(query ? "(no notes match)" : "(no notes yet)");
    }
  }
}
