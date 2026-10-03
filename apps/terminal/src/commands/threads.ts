// apx2 threads / runs / agents / secrets: reading and steering what the core holds.
import type { ApxClient } from "@apx/protocol/client";

export async function threads(client: ApxClient, [sub, id]: string[]): Promise<void> {
  if (!sub || sub === "list") {
    const { threads } = await client.call("threads.list", {});
    for (const t of threads) console.log(`${t.id.padEnd(22)} ${t.state.padEnd(10)} ${t.kind.padEnd(6)} ${t.title}`);
    return;
  }
  if (!id) throw new Error(`usage: apx2 threads ${sub} <thread>`);
  if (sub === "get") {
    const t = await client.call("threads.get", { thread: id });
    console.log(`${t.thread.title} · ${t.thread.kind} · ${t.thread.state}`);
    for (const m of t.messages.slice(-20)) {
      const who = m.author.kind === "agent" ? m.author.id : m.author.kind;
      const text = m.parts
        .map((p) => (p.type === "text" ? p.text : p.type === "notice" ? `[${p.text}]` : `[${p.type}]`))
        .join(" ");
      console.log(`  ${who.padEnd(10)} ${text.slice(0, 200)}`);
    }
    return;
  }
  if (sub === "cancel") {
    const r = await client.call("threads.cancel", { thread: id });
    console.log(`canceled ${r.canceled}`);
    return;
  }
  throw new Error(`unknown threads command: ${sub}`);
}

export async function runs(client: ApxClient, [sub, id, ...rest]: string[], timeoutS = 60): Promise<void> {
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
    if (!id || !answer) throw new Error('usage: apx2 runs respond <input> approve|deny ["note"] | "<answer text>"');
    const decision = answer === "approve" || answer === "deny" ? answer : undefined;
    const text = decision ? note.join(" ") || undefined : [answer, ...note].join(" ");
    const r = await client.call("runs.respond", {
      input: id,
      ...(decision ? { decision } : {}),
      ...(text ? { text } : {}),
    });
    console.log(`${r.id} ${r.state}`);
    return;
  }
  if (!id || (sub !== "get" && sub !== "wait")) throw new Error("usage: apx2 runs get|wait|pending|respond …");
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
  if (!name) throw new Error(`usage: apx2 secrets ${sub} <name>`);
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
  if (!value) throw new Error("pipe the value in: … | apx2 secrets set <name>");
  await client.call("secrets.set", { name, value });
  console.log(`stored ${name}`);
}

function choiceLabel(c: { model?: string | undefined; router: boolean } | undefined): string {
  if (!c) return "default";
  if (!c.model) return "router";
  return c.router ? `${c.model} → router` : c.model;
}

export async function projects(client: ApxClient, [sub, arg]: string[]): Promise<void> {
  if (!sub || sub === "list") {
    const { projects } = await client.call("projects.list", {});
    for (const p of projects)
      console.log(`${p.id.padEnd(16)} ${p.present ? " " : "!"} ${p.name.padEnd(24)} ${p.kind ?? ""}`);
    return;
  }
  if (sub === "register") {
    if (!arg) throw new Error("usage: apx2 projects register <folder>");
    const { resolve } = await import("node:path");
    const r = await client.call("projects.register", { path: resolve(arg) });
    console.log(`${r.project.name} (${r.project.id}): ${r.agents} agents`);
    return;
  }
  if (sub === "sync") {
    const r = await client.call("projects.sync", arg ? { project: arg } : {});
    console.log(`read ${r.projects} projects · ${r.agents} agents · ${r.archived} archived`);
    return;
  }
  throw new Error(`unknown projects command: ${sub}`);
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
  if (!id) throw new Error(`usage: apx2 jobs ${sub} <job>`);
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

/** apx2 mcps: MCP servers agents may use (list, approve a project's, add or remove the owner's own). */
export async function mcps(client: ApxClient, [sub, a, b, ...rest]: string[]): Promise<void> {
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
    if (!a || !b) throw new Error(`usage: apx2 mcps ${sub} <project> <server>`);
    const r = await client.call("mcp.trust", { project: a, server: b, trusted: sub === "trust" });
    console.log(`${r.server.name}: ${r.server.status}`);
    return;
  }
  if (sub === "add") {
    // apx2 mcps add <name> <command> [args…]   or   apx2 mcps add <name> https://…
    if (!a || !b) throw new Error("usage: apx2 mcps add <name> <command> [args…] | <url>");
    const server = /^https?:\/\//.test(b) ? { url: b } : { command: b, args: rest };
    await client.call("mcp.set", { name: a, server });
    console.log(`added ${a}`);
    return;
  }
  if (sub === "rm") {
    if (!a) throw new Error("usage: apx2 mcps rm <name>");
    await client.call("mcp.set", { name: a, server: null });
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
}

export async function skills(client: ApxClient, [project]: string[]): Promise<void> {
  const r = await client.call("skills.list", project ? { project } : {});
  for (const s of r.skills) console.log(`${s.name.padEnd(32)} ${s.scope.padEnd(8)} ${s.description.slice(0, 90)}`);
  if (!r.skills.length) console.log("(no skills: add folders with a SKILL.md under ~/.apx/v2/skills or .apc/skills)");
}
