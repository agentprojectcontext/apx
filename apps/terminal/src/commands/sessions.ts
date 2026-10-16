// apx sessions: the owner's Claude Code and Codex work brought into APX as projects whose chats agents take over.
import type { ApxClient } from "@apx/protocol/client";

const USAGE = `apx sessions projects codex|claude              Projects there and their chats ("*" = already in APX)
apx sessions import codex|claude <project> [--only <id,…>] [--name "…"]
                                                Bring a project's chats in (again: only what is new)
apx sessions digest <thread> [--refresh]        What an imported chat is about, for the agent that takes it over
apx sessions adopt <thread> <agent>             That agent answers in the chat from now on
apx sessions page <project> <file.html> [--name n] [--title "…"]   A page the chats wrote, as a pinned widget
<project> is the folder or the name the list shows`;

type Opts = {
  only?: string | undefined;
  name?: string | undefined;
  title?: string | undefined;
  refresh?: boolean | undefined;
  json?: boolean | undefined;
};

const engineOf = (v: string | undefined) => {
  if (v === "codex" || v === "claude") return v;
  throw new Error(USAGE);
};

const day = (iso: string) => iso.slice(0, 10);

export async function sessions(client: ApxClient, [sub, ...rest]: string[], opts: Opts): Promise<void> {
  const out = (v: unknown, text: () => void) => (opts.json ? console.log(JSON.stringify(v, null, 2)) : text());
  switch (sub) {
    case "projects":
    case "list": {
      const engine = engineOf(rest[0]);
      const r = await client.call("sessions.projects", { engine });
      return out(r, () => {
        if (!r.projects.length) console.log(`No ${engine} sessions on this computer.`);
        for (const p of r.projects) {
          console.log(`${p.name}  ${p.cwd}${p.project_id ? `  (APX project ${p.project_id})` : ""}`);
          for (const s of p.sessions)
            console.log(`  ${s.thread ? "*" : " "} ${s.id}  ${day(s.updated_at)}  ${s.title}`);
        }
      });
    }
    case "import": {
      const engine = engineOf(rest[0]);
      const which = rest.slice(1).join(" ").trim();
      if (!which) throw new Error(USAGE);
      const { projects } = await client.call("sessions.projects", { engine });
      const lower = which.toLowerCase();
      const hits = projects.filter(
        (p) =>
          p.cwd === which || p.cwd.replace(/\/+$/, "") === which.replace(/\/+$/, "") || p.name.toLowerCase() === lower,
      );
      if (hits.length !== 1)
        throw new Error(
          hits.length
            ? `"${which}" matches ${hits.map((p) => p.cwd).join(", ")}; use the folder`
            : `no ${engine} project "${which}"; run \`apx sessions projects ${engine}\``,
        );
      const only = opts.only
        ?.split(",")
        .map((s) => s.trim())
        .filter(Boolean);
      const r = await client.call("sessions.import", {
        engine,
        cwd: hits[0]?.cwd ?? which,
        ...(only?.length ? { sessions: only } : {}),
        ...(opts.name ? { name: opts.name } : {}),
      });
      return out(r, () => {
        console.log(`Project ${r.project.name} (${r.project.id})`);
        for (const c of r.chats)
          console.log(`  ${c.thread}  ${c.created ? "new" : c.added ? `+${c.added}` : "up to date"}  ${c.title}`);
        const x = r.extras;
        if (x) {
          if (x.mcps.added.length)
            console.log(`MCP servers added (approve them in the project): ${x.mcps.added.join(", ")}`);
          if (x.mcps.existing.length) console.log(`MCP servers already there: ${x.mcps.existing.join(", ")}`);
          for (const m of x.mcps.need_values)
            console.log(
              `MCP server ${m.name} holds a credential (${m.keys.join(", ")}): add it yourself with its value`,
            );
          if (x.notes) console.log(`Memory notes: ${x.notes}`);
          if (x.tasks) console.log(`Open tasks on the board: ${x.tasks}`);
          if (x.routines.length)
            console.log(`Routines, turned off (turn off the original first): ${x.routines.join(", ")}`);
        }
        if (r.pages.length) {
          console.log("Pages these chats wrote (apx sessions page <project> <file>):");
          for (const p of r.pages) console.log(`  ${p}`);
        }
      });
    }
    case "digest": {
      const thread = rest[0];
      if (!thread) throw new Error(USAGE);
      const r = await client.call("sessions.digest", { thread, ...(opts.refresh ? { refresh: true } : {}) });
      return out(r, () => console.log(r.digest));
    }
    case "adopt": {
      const [thread, agent] = rest;
      if (!thread || !agent) throw new Error(USAGE);
      const t = await client.call("sessions.adopt", { thread, agent });
      return out(t, () => console.log(`${t.title} (${t.id}) is now ${agent}'s chat`));
    }
    case "page": {
      const [project, file] = rest;
      if (!project || !file) throw new Error(USAGE);
      const s = await client.call("surfaces.import_page", {
        project_id: project,
        path: file,
        ...(opts.name ? { name: opts.name } : {}),
        ...(opts.title ? { title: opts.title } : {}),
      });
      return out(s, () => console.log(`Widget ${s.title} (${s.id}) pinned on the project's board`));
    }
    default:
      console.log(USAGE);
  }
}
