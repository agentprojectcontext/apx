// apx threads / runs / agents / secrets: reading and steering what the core holds.
import os from "node:os";
import path from "node:path";
import {
  AGENTS_MD_LIMIT,
  ApprovalScope,
  type Author,
  Autonomy,
  DEFAULT_AUTONOMY,
  type Message,
  ProjectKind,
} from "@apx/protocol";
import type { ApxClient } from "@apx/protocol/client";

/** Who wrote a message, in one word: the agent's id, or the author's kind. */
export const authorOf = (a: Author) => (a.kind === "agent" ? a.id : a.kind);

/** A message as one line of text: its text parts, notices in brackets, other parts by their type. */
export const messageText = (m: Message) =>
  m.parts.map((p) => (p.type === "text" ? p.text : p.type === "notice" ? `[${p.text}]` : `[${p.type}]`)).join(" ");

export async function threads(
  client: ApxClient,
  [sub, id, ...rest]: string[],
  o: { json?: boolean | undefined } = {},
): Promise<void> {
  if (!sub || sub === "list") {
    const { threads } = await client.call("threads.list", {});
    for (const t of threads) console.log(`${t.id.padEnd(22)} ${t.state.padEnd(10)} ${t.kind.padEnd(6)} ${t.title}`);
    return;
  }
  if (sub === "search") {
    const query = [id, ...rest].filter(Boolean).join(" ").trim();
    if (!query) throw new Error("usage: apx threads search <words…>");
    const { hits } = await client.call("threads.search", { query });
    for (const h of hits)
      console.log(
        `${h.thread_id.padEnd(22)} ${new Date(h.created_at).toLocaleString()}  ${authorOf(h.author).padEnd(10)} ${h.snippet.replace(/\s+/g, " ")}`,
      );
    if (!hits.length) console.log("(no messages match)");
    return;
  }
  if (!id) throw new Error(`usage: apx threads ${sub} <thread>`);
  if (sub === "get") {
    const t = await client.call("threads.get", { thread: id });
    if (o.json) {
      console.log(JSON.stringify(t, null, 2));
      return;
    }
    console.log(`${t.thread.title} · ${t.thread.kind} · ${t.thread.state}`);
    if (t.thread.cwd) console.log(`Folder: ${t.thread.cwd} · writes: ${t.thread.write ?? "ask"}`);
    for (const m of t.messages.slice(-20))
      console.log(`  ${authorOf(m.author).padEnd(10)} ${messageText(m).slice(0, 200)}`);
    return;
  }
  if (sub === "cancel") {
    const r = await client.call("threads.cancel", { thread: id });
    console.log(`canceled ${r.canceled}`);
    return;
  }
  throw new Error(`unknown threads command: ${sub}`);
}

export async function runs(
  client: ApxClient,
  [sub, id, ...rest]: string[],
  timeoutS = 60,
  approvalScope?: string,
): Promise<void> {
  if (sub === "pending") {
    const { inputs } = await client.call("runs.pending", id ? { thread: id } : {});
    for (const i of inputs)
      console.log(
        `${i.id}  ${i.kind.padEnd(8)} ${i.thread_id}\n  ${i.prompt}${i.detail ? `\n  ${i.detail}` : ""}${i.options?.length ? `\n  options: ${i.options.join(" / ")}` : ""}`,
      );
    if (!inputs.length) console.log("(nothing is waiting for you)");
    return;
  }
  if (sub === "respond") {
    const [answer, ...note] = rest;
    if (!id || !answer) throw new Error('usage: apx runs respond <input> approve|deny ["note"] | "<answer text>"');
    const decision = answer === "approve" || answer === "deny" ? answer : undefined;
    const text = decision ? note.join(" ") || undefined : [answer, ...note].join(" ");
    const r = await client.call("runs.respond", {
      input: id,
      ...(decision ? { decision } : {}),
      ...(approvalScope ? { scope: ApprovalScope.parse(approvalScope) } : {}),
      ...(text ? { text } : {}),
    });
    console.log(`${r.id} ${r.state}${r.approval_scope ? ` (${r.approval_scope})` : ""}`);
    return;
  }
  if (!id || (sub !== "get" && sub !== "wait")) throw new Error("usage: apx runs get|wait|pending|respond …");
  const r =
    sub === "get"
      ? await client.call("runs.get", { run: id })
      : await client.call("runs.wait", { run: id, timeout_s: timeoutS });
  console.log(JSON.stringify(r, null, 2));
}

export async function agents(client: ApxClient): Promise<void> {
  const { agents } = await client.call("agents.list", {});
  for (const a of agents)
    console.log(
      `${a.id.padEnd(28)} ${a.kind === "secretary" ? "★" : " "} ${a.name.padEnd(16)} ${choiceLabel(a.model_choice).padEnd(28)} ${a.role}`,
    );
}

export async function secrets(client: ApxClient, [sub, name]: string[]): Promise<void> {
  if (!sub || sub === "list") {
    const { secrets } = await client.call("secrets.list", {});
    for (const s of secrets) console.log(`${s.name.padEnd(20)} ${s.updated_at}`);
    if (!secrets.length) console.log("(none)");
    return;
  }
  if (!name) throw new Error(`usage: apx secrets ${sub} <name>`);
  if (sub === "rm") {
    await client.call("secrets.set", { name, value: null });
    console.log(`removed ${name}`);
    return;
  }
  if (sub !== "set") throw new Error(`unknown secrets command: ${sub}`);
  // The value comes from stdin, never from argv (it would show up in the process list and shell history).
  let value = "";
  for await (const chunk of process.stdin) value += String(chunk);
  value = value.trim();
  if (!value) throw new Error("pipe the value in: … | apx secrets set <name>");
  await client.call("secrets.set", { name, value });
  console.log(`stored ${name}`);
}

function choiceLabel(c: { model?: string | undefined; router: boolean } | undefined): string {
  if (!c) return "default";
  if (!c.model) return "router";
  return c.router ? `${c.model} → router` : c.model;
}

type ProjectFlags = {
  autonomy?: string | undefined;
  path?: string | undefined;
  kind?: string | undefined;
  desc?: string | undefined;
  name?: string | undefined;
};

function autonomyOf(level: string | undefined): Autonomy | undefined {
  if (level === undefined) return undefined;
  const a = Autonomy.safeParse(level);
  if (!a.success) throw new Error(`--autonomy is one of ${Autonomy.options.join(", ")}`);
  return a.data;
}

function kindOf(kind: string | undefined): ProjectKind | undefined {
  if (kind === undefined) return undefined;
  const k = ProjectKind.safeParse(kind);
  if (!k.success) throw new Error(`--kind is one of ${ProjectKind.options.join(", ")}`);
  return k.data;
}

export async function projects(client: ApxClient, [sub, arg, ...more]: string[], o: ProjectFlags = {}): Promise<void> {
  if (!sub || sub === "list") {
    const { projects } = await client.call("projects.list", {});
    for (const p of projects) {
      console.log(`${p.id.padEnd(16)} ${p.present ? " " : "!"} ${p.name.padEnd(24)} ${p.kind ?? ""}`);
      if (p.agents_md_chars)
        console.log(
          `${"".padEnd(18)} AGENTS.md has ${p.agents_md_chars} chars, past the ${AGENTS_MD_LIMIT} limit: agents get its start and end`,
        );
    }
    return;
  }
  if (sub === "register") {
    if (!arg) throw new Error("usage: apx projects register <folder>");
    const { resolve } = await import("node:path");
    const r = await client.call("projects.register", { path: resolve(arg) });
    console.log(`${r.project.name} (${r.project.id}): ${r.agents} agents`);
    return;
  }
  if (sub === "create") {
    const name = [arg, ...more].filter(Boolean).join(" ") || undefined;
    if (!name && !o.path)
      throw new Error('usage: apx projects create "<Name>" [--path <folder>] [--kind <kind>] [--desc "…"]');
    const kind = kindOf(o.kind);
    const { resolve } = await import("node:path");
    const { homedir } = await import("node:os");
    const r = await client.call("projects.create", {
      ...(name ? { name } : {}),
      ...(o.path ? { path: resolve(o.path.replace(/^~(?=$|[/\\])/, homedir())) } : {}),
      ...(kind ? { kind } : {}),
      ...(o.desc ? { description: o.desc } : {}),
    });
    console.log(`${r.project.name} (${r.project.id}) · ${r.project.path ?? ""}`);
    return;
  }
  if (sub === "set") {
    if (!arg || (o.name === undefined && o.kind === undefined && o.desc === undefined && o.autonomy === undefined))
      throw new Error(
        'usage: apx projects set <project> [--name "…"] [--kind <kind>] [--desc "…"] [--autonomy <level>]',
      );
    const kind = kindOf(o.kind);
    const autonomy = autonomyOf(o.autonomy);
    const r = await client.call("projects.update", {
      project: arg,
      ...(o.name !== undefined ? { name: o.name } : {}),
      ...(kind ? { kind } : {}),
      ...(o.desc !== undefined ? { description: o.desc } : {}),
      ...(autonomy ? { autonomy } : {}),
    });
    console.log(
      `${r.project.name} (${r.project.id})${r.project.kind ? ` · ${r.project.kind}` : ""} · mode ${r.project.autonomy ?? DEFAULT_AUTONOMY}`,
    );
    return;
  }
  if (sub === "folders") return folders(client, arg, more);
  if (sub === "sync") {
    const r = await client.call("projects.sync", arg ? { project: arg } : {});
    console.log(`read ${r.projects} projects · ${r.agents} agents · ${r.archived} archived`);
    return;
  }
  if (sub === "rm") {
    if (!arg) throw new Error("usage: apx projects rm <project>");
    await client.call("projects.unregister", { project: arg });
    console.log(`${arg} is no longer a project in APX; its folder and files were not touched`);
    return;
  }
  throw new Error(`unknown projects command: ${sub}`);
}

/** apx projects folders: the folders a project's agents may read and never change. */
async function folders(client: ApxClient, sub: string | undefined, [project, dir]: string[]): Promise<void> {
  const usage = "usage: apx projects folders list|add|rm <project> [folder]";
  if (!sub || !project || !["list", "add", "rm"].includes(sub) || (sub !== "list" && !dir)) throw new Error(usage);
  const { projects } = await client.call("projects.list", {});
  const p = projects.find((x) => x.id === project);
  if (!p) throw new Error(`no project ${project}`);
  let shown = p.read_only_folders ?? [];
  if (dir && sub !== "list") {
    const { resolve } = await import("node:path");
    const { homedir } = await import("node:os");
    const at = resolve(dir.replace(/^~(?=$|[/\\])/, homedir()));
    const next = sub === "add" ? [...shown, at] : shown.filter((f) => f !== at && f !== dir);
    if (next.length === shown.length) throw new Error(`${dir} is not a read-only folder of ${p.name}`);
    const r = await client.call("projects.update", { project, read_only_folders: next });
    shown = r.project.read_only_folders ?? [];
  }
  console.log(shown.length ? shown.join("\n") : `(${p.name} has no read-only folders)`);
}

export async function jobs(client: ApxClient, [sub, id]: string[]): Promise<void> {
  if (!sub || sub === "list") {
    const { running, finished } = await client.call("jobs.list", { finished: 10 });
    const row = (j: (typeof running)[number]) =>
      `${j.id.padEnd(24)} ${j.kind.padEnd(8)} ${j.state.padEnd(10)} ${j.title.slice(0, 70)}${j.exit_code === undefined ? "" : ` (exit ${j.exit_code})`}`;
    console.log(running.length ? running.map(row).join("\n") : "(nothing running)");
    if (finished.length) console.log(`\nfinished:\n${finished.map(row).join("\n")}`);
    return;
  }
  if (!id) throw new Error(`usage: apx jobs ${sub} <job>`);
  if (sub === "get") {
    const r = await client.call("jobs.get", { job: id });
    console.log(`${r.job.title} · ${r.job.state}${r.job.cwd ? ` · ${r.job.cwd}` : ""}`);
    if (r.output) console.log(r.output);
    return;
  }
  if (sub === "cancel") {
    const r = await client.call("jobs.cancel", { job: id });
    console.log(r.canceled ? `stopped ${id}` : `${id} was not running`);
    return;
  }
  throw new Error(`unknown jobs command: ${sub}`);
}

/** apx mcps: MCP servers agents may use (list, approve a project's, add or remove the owner's own). */
/** `K=V` pairs from repeated --env / --header options. */
function pairs(list: string[] | undefined, flag: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const item of list ?? []) {
    const at = item.indexOf("=");
    if (at < 1) throw new Error(`--${flag} takes NAME=value, got "${item}"`);
    out[item.slice(0, at)] = item.slice(at + 1);
  }
  return out;
}

export async function mcps(
  client: ApxClient,
  [sub, a, b, ...rest]: string[],
  o: { project?: string | undefined; env?: string[] | undefined; header?: string[] | undefined } = {},
): Promise<void> {
  const where = o.project ? { project: o.project } : {};
  /** One server's definition, the owner's own or (with --project) that project's file's. */
  const definition = async (name: string) => {
    const { servers } = await client.call("mcp.list", where);
    const s = servers.find((x) => x.name === name && (o.project ? x.scope === "project" : x.scope === "global"));
    if (!s) throw new Error(`no MCP server ${name}${o.project ? ` in ${o.project}` : ""}`);
    if (!s.definition) throw new Error(`${name} comes with an extension: it is changed there`);
    return { status: s, def: s.definition };
  };
  const save = async (name: string, server: Record<string, unknown>) => {
    const r = await client.call("mcp.set", { name, ...where, server: server as never });
    const s = r.servers.find((x) => x.name === name);
    console.log(`${name}: ${s?.status ?? "saved"} · live from the next message`);
  };
  if (sub === "show") {
    if (!a) throw new Error("usage: apx mcps show <name> [--project p]");
    const { status, def } = await definition(a);
    console.log(JSON.stringify({ name: a, status: status.status, enabled: status.enabled, ...def }, null, 2));
    return;
  }
  if (sub === "copy") {
    if (!a || !b) throw new Error("usage: apx mcps copy <from> <to> [--env K=V…] [--header K=V…]");
    const { def } = await definition(a);
    await save(b, {
      ...(def.url
        ? { url: def.url, headers: { ...def.headers, ...pairs(o.header, "header") } }
        : { command: def.command, args: def.args }),
      env: { ...def.env, ...pairs(o.env, "env") },
    });
    return;
  }
  if (sub === "rename") {
    if (!a || !b) throw new Error("usage: apx mcps rename <name> <new-name>");
    const { status, def } = await definition(a);
    // The new one is saved before the old one goes: nothing is lost if either step fails.
    await save(b, {
      ...(def.url ? { url: def.url, headers: def.headers } : { command: def.command, args: def.args }),
      env: def.env,
      enabled: status.enabled,
    });
    await client.call("mcp.set", { name: a, ...where, server: null });
    console.log(`renamed ${a} to ${b}`);
    return;
  }
  if (sub === "set") {
    if (!a || (!o.env?.length && !o.header?.length))
      throw new Error("usage: apx mcps set <name> --env K=V… [--header K=V…]");
    const { status, def } = await definition(a);
    await save(a, {
      ...(def.url
        ? { url: def.url, headers: { ...def.headers, ...pairs(o.header, "header") } }
        : { command: def.command, args: def.args }),
      env: { ...def.env, ...pairs(o.env, "env") },
      enabled: status.enabled,
    });
    return;
  }
  if (!sub || sub === "list") {
    const { servers } = await client.call("mcp.list", a ? { project: a } : {});
    for (const s of servers)
      console.log(
        `${(s.project_id ?? "global").padEnd(16)} ${s.name.padEnd(18)} ${s.status.padEnd(15)} ${String(s.tools).padStart(3)} tools  ${s.error ?? s.target}`,
      );
    if (!servers.length) console.log("(no MCP servers)");
    return;
  }
  if (sub === "trust" || sub === "untrust") {
    if (!a || !b) throw new Error(`usage: apx mcps ${sub} <project> <server>`);
    const r = await client.call("mcp.trust", { project: a, server: b, trusted: sub === "trust" });
    console.log(`${r.server.name}: ${r.server.status}`);
    return;
  }
  if (sub === "on" || sub === "off") {
    // A global server is switched per project: the core keeps no install-wide off switch.
    if (!a || !o.project) throw new Error(`usage: apx mcps ${sub} <server> --project <project>`);
    const r = await client.call("mcp.toggle", { project: o.project, server: a, on: sub === "on" });
    const s = r.servers.find((x) => x.name === a && x.scope === "global");
    console.log(`${a} in ${o.project}: ${sub}${s && sub === "on" ? ` · ${s.status}` : ""}`);
    return;
  }
  if (sub === "add") {
    // apx mcps add <name> <command> [args…]   or   apx mcps add <name> https://…
    if (!a || !b) throw new Error("usage: apx mcps add <name> <command> [args…] | <url>");
    const env = pairs(o.env, "env");
    const server = /^https?:\/\//.test(b)
      ? { url: b, headers: pairs(o.header, "header"), env }
      : { command: b, args: rest, env };
    await save(a, server);
    return;
  }
  if (sub === "rm") {
    if (!a) throw new Error("usage: apx mcps rm <name>");
    await client.call("mcp.set", { name: a, ...where, server: null });
    console.log(`removed ${a}`);
    return;
  }
  throw new Error(`unknown mcps command: ${sub}`);
}

export async function usage(client: ApxClient, [days]: string[]): Promise<void> {
  const since = new Date(Date.now() - Number(days ?? 30) * 86_400_000).toISOString();
  const r = await client.call("usage.summary", { since });
  console.log(`since ${r.since.slice(0, 10)}`);
  for (const m of r.models)
    console.log(
      `${m.model.padEnd(44)} ${m.billing.padEnd(9)} ${String(m.runs).padStart(5)} runs  ${String(m.input).padStart(10)} in  ${String(m.output).padStart(9)} out`,
    );
  if (r.aux.length) console.log("auxiliary model (titles, summaries, room filters, commit messages):");
  for (const a of r.aux)
    console.log(
      `${`${a.model} · ${a.purpose}`.padEnd(44)} ${"metered".padEnd(9)} ${String(a.calls).padStart(5)} calls ${String(a.input).padStart(10)} in  ${String(a.output).padStart(9)} out`,
    );
}

/** The skills other agent apps get for APX: the core keeps them current at every start; this does it now. */
export async function runtimeSkills(client: ApxClient, dryRun: boolean): Promise<void> {
  const r = await client.call("skills.runtimes", { dry_run: dryRun });
  const home = os.homedir();
  // path.relative compares as the system does (any case on Windows).
  const tilde = (p: string) => {
    const rel = path.relative(home, p);
    return rel && !rel.startsWith("..") && !path.isAbsolute(rel) ? `~${path.sep}${rel}` : p;
  };
  const verb = dryRun
    ? { create: "would create", update: "would update", remove: "would remove" }
    : { create: "created", update: "updated", remove: "removed" };
  const said = { ...verb, unchanged: "unchanged", "skip-link": "left alone (a link)" };
  for (const s of r.steps) console.log(`${s.runtime.padEnd(20)} ${tilde(s.dir).padEnd(36)} ${said[s.action]}`);
  for (const m of r.missing) console.log(`${m.runtime.padEnd(20)} ${tilde(m.dir).padEnd(36)} not installed, skipped`);
  if (!r.steps.length) console.log("(no agent app found: nothing to do)");
}

/** apx, global or project for APX's folders; the app's name (claude, codex…) for a skill read from that app. */
const placeOf = (s: { source: string; scope: string }) =>
  s.source === "apx" ? "apx" : ["owner", "project", "extension"].includes(s.source) ? s.scope : s.source;

export async function skills(
  client: ApxClient,
  [sub, name]: string[],
  o: { project?: string | undefined } = {},
): Promise<void> {
  if (sub === "save") {
    if (!name) throw new Error("usage: apx skills save <skill> [--project <project>] < SKILL.md");
    // The whole SKILL.md (frontmatter and body) on stdin: a body would not survive as an argument.
    let content = "";
    for await (const chunk of process.stdin) content += String(chunk);
    if (!content.trim()) throw new Error("pipe the SKILL.md in: … | apx skills save <skill>");
    const r = await client.call("skills.save", {
      name,
      target: o.project ? "project" : "global",
      content,
      ...(o.project ? { project: o.project } : {}),
    });
    console.log(`saved ${r.skill.name} · ${r.skill.path}`);
    return;
  }
  if (sub === "on" || sub === "off") {
    if (!name) throw new Error(`usage: apx skills ${sub} <skill> [--project <project>]`);
    await client.call("skills.toggle", { name, on: sub === "on", ...(o.project ? { project: o.project } : {}) });
    console.log(`${name}: ${sub}${o.project ? ` in ${o.project}` : " everywhere"}`);
    return;
  }
  // `apx skills`, `apx skills list [project]` or, as before, `apx skills <project>`.
  const project = (sub === "list" ? name : sub) ?? o.project;
  const r = await client.call("skills.list", project ? { project } : {});
  for (const s of r.skills)
    console.log(
      `${s.name.padEnd(32)} ${placeOf(s).padEnd(8)} ${s.on ? "   " : "off"} ${s.description.slice(0, 90)}${s.copies.length ? ` (also in ${s.copies.map((c) => c.source).join(", ")})` : ""}`,
    );
  if (!r.skills.length) console.log("(no skills: add folders with a SKILL.md under ~/.apx/v2/skills or .apc/skills)");
}
