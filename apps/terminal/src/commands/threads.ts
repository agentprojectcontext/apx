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

export async function runs(client: ApxClient, [sub, id]: string[], timeoutS = 60): Promise<void> {
  if (!id || (sub !== "get" && sub !== "wait")) throw new Error("usage: apx2 runs get|wait <run>");
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
