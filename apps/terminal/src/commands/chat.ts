// apx2 chat: the one way to talk to an agent from the terminal. Sends with threads.send and prints the answer as
// it builds (tool steps, sub-threads, widgets, notices), until this send's own run ends.
import { CoreEvent, type Part } from "@apx/protocol";
import type { ApxClient } from "@apx/protocol/client";

export type ChatOptions = {
  thread?: string | undefined;
  agent?: string | undefined;
  new?: boolean | undefined;
  detach?: boolean | undefined;
  interrupt?: boolean | undefined;
  steer?: boolean | undefined;
};

/** The thread to write in: explicit, the agent's latest (or a new one), or Home. */
async function pickThread(client: ApxClient, o: ChatOptions): Promise<string> {
  if (o.thread) return o.thread;
  if (!o.agent) return "home";
  const { agents } = await client.call("agents.list", {});
  const agent =
    agents.find((a) => a.id === o.agent) ?? agents.filter((a) => a.name.toLowerCase() === o.agent?.toLowerCase())[0];
  if (!agent) throw new Error(`unknown agent ${o.agent} (see apx2 agents)`);
  if (!o.new) {
    const { threads } = await client.call("threads.list", {});
    const mine = threads.find((t) => t.kind !== "home" && t.agent_ids[0] === agent.id);
    if (mine) return mine.id;
    if (agent.kind === "secretary") return "home";
  }
  return (await client.call("threads.create", { kind: "agent", agent_id: agent.id })).id;
}

function line(p: Part): string | undefined {
  switch (p.type) {
    case "tool":
      return p.status === "running" ? undefined : `  ${p.status === "ok" ? "✓" : "✗"} ${p.title}`;
    case "subthread":
      return `  ↳ ${p.state} · ${p.title}${p.summary ? ` — ${p.summary.slice(0, 80)}` : ""}`;
    case "surface":
      return `  ▣ widget: ${p.title} (v${p.version})`;
    case "browser":
      return `  ◎ browser ${p.state}: ${p.url}`;
    case "notice":
      return `  ! ${p.text}`;
    case "input":
      return p.state === "pending"
        ? `  ? ${p.prompt}${p.detail ? `\n    ${p.detail}` : ""}${p.options?.length ? `\n    options: ${p.options.join(" / ")}` : ""}\n    answer: apx2 runs respond ${p.input_id} ${p.kind === "confirm" ? "approve|deny" : '"<text>"'}`
        : `  ? ${p.kind === "confirm" ? "confirmation" : "question"} ${p.state}${p.answer ? `: ${p.answer}` : ""}`;
    default:
      return undefined;
  }
}

export async function chat(client: ApxClient, text: string, o: ChatOptions): Promise<void> {
  if (!text) throw new Error('usage: apx2 chat "<text>" [--agent <id> | --thread <id>] [--new] [--detach]');
  const thread = await pickThread(client, o);
  const socket = await client.connect();
  const printed = new Set<string>();
  let runId: string | undefined;
  let messageId: string | undefined;
  const early = new Map<string, string>();
  let finish: (state: string) => void = () => {};
  const done = new Promise<string>((resolve) => {
    finish = resolve;
  });
  socket.onEvent((frame) => {
    const ev = CoreEvent.safeParse(frame.payload);
    if (!ev.success) return;
    const e = ev.data;
    if (e.type === "run.updated" && e.run.thread_id === thread) {
      if (e.run.ended_at) early.set(e.run.id, e.run.state);
      if (e.run.id === runId && e.run.ended_at) finish(e.run.state);
    }
    if (e.type === "message.created" && e.message.run_id && e.message.run_id === runId) messageId = e.message.id;
    const parts =
      e.type === "message.part" && e.thread_id === thread && e.message_id === messageId
        ? [{ msg: e.message_id, i: e.index, part: e.part }]
        : (e.type === "message.created" || e.type === "message.updated") &&
            e.message.thread_id === thread &&
            e.message.run_id === runId
          ? e.message.parts.map((part, i) => ({ msg: e.message.id, i, part }))
          : [];
    for (const { msg, i, part } of parts) {
      const out = line(part);
      const key = `${msg}:${i}:${out}`;
      if (!out || printed.has(key)) continue;
      printed.add(key);
      console.log(out);
    }
  });
  const mode = o.interrupt ? "interrupt" : o.steer ? "steer" : "queue";
  const sent = await socket.call("threads.send", { thread, text, mode });
  if (sent.steered) {
    console.log(`steered into the running turn ${sent.run.id} · thread ${thread}`);
    socket.close();
    return;
  }
  runId = sent.run.id;
  if (o.detach) {
    console.log(`sent · run ${runId} · thread ${thread}`);
    socket.close();
    return;
  }
  const endedEarly = early.get(runId);
  if (endedEarly) finish(endedEarly);
  const state = await done;
  const { messages } = await socket.call("threads.get", { thread });
  const answer = messages.filter((m) => m.run_id === runId).at(-1);
  const textPart = answer?.parts.find((p) => p.type === "text");
  if (textPart?.type === "text") console.log(`\n${textPart.text}`);
  console.log(`— ${state}${answer?.model ? ` · ${answer.model}` : ""} · thread ${thread}`);
  socket.close();
  if (state !== "completed") process.exitCode = 1;
}
