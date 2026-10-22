// apx chat: the one way to talk to an agent from the terminal. Sends with threads.send and prints the answer as
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
  /** A code thread in the project that holds `cwd` (default: this folder). */
  code?: boolean | undefined;
  cwd?: string | undefined;
  write?: string | undefined;
};

/** The thread to write in: explicit, the agent's latest (or a new one), or Home. */
async function pickThread(client: ApxClient, o: ChatOptions): Promise<string> {
  if (o.thread) return o.thread;
  if (o.code) return codeThread(client, o);
  if (!o.agent) return "home";
  const { agents } = await client.call("agents.list", {});
  const agent =
    agents.find((a) => a.id === o.agent) ?? agents.filter((a) => a.name.toLowerCase() === o.agent?.toLowerCase())[0];
  if (!agent) throw new Error(`unknown agent ${o.agent} (see apx agents)`);
  if (!o.new) {
    if (agent.kind === "secretary") return "home";
    const mine = latestConversation((await client.call("threads.list", {})).threads, agent.id);
    if (mine) return mine;
  }
  return (await client.call("threads.create", { kind: "agent", agent_id: agent.id })).id;
}

/**
 * The agent's latest conversation with the owner: a routine run, a task, a code session or a channel's chat is never
 * one (a message there would land in the middle of that work).
 */
export function latestConversation(
  threads: ReadonlyArray<{ id: string; kind: string; agent_ids: readonly string[] }>,
  agentId: string,
): string | undefined {
  return threads.find((t) => (t.kind === "agent" || t.kind === "loose") && t.agent_ids[0] === agentId)?.id;
}

/** A new code thread for the agent (default: the secretary) in the registered project that holds the folder. */
async function codeThread(client: ApxClient, o: ChatOptions): Promise<string> {
  const { resolve, relative, sep } = await import("node:path");
  const { realpathSync } = await import("node:fs");
  const dir = realpathSync(resolve(o.cwd ?? "."));
  const { projects } = await client.call("projects.list", {});
  const inside = (p: string) => dir === p || dir.startsWith(`${p}${sep}`);
  const project = projects
    .filter((p) => p.path && inside(realpathSync(p.path)))
    .sort((a, b) => (b.path?.length ?? 0) - (a.path?.length ?? 0))[0];
  if (!project?.path) throw new Error(`${dir} is not inside a registered project (apx projects register <folder>)`);
  const { agents } = await client.call("agents.list", {});
  const agent = o.agent
    ? agents.find((a) => a.id === o.agent || a.name.toLowerCase() === o.agent?.toLowerCase())
    : agents.find((a) => a.kind === "secretary");
  if (!agent) throw new Error(`unknown agent ${o.agent ?? "(secretary)"}`);
  const write = o.write === "auto" || o.write === "read-only" ? o.write : "ask";
  const t = await client.call("threads.create", {
    kind: "code",
    agent_id: agent.id,
    project_id: project.id,
    cwd: relative(realpathSync(project.path), dir) || ".",
    write,
  });
  console.log(`code thread ${t.id} · ${t.cwd} · write: ${t.write}`);
  return t.id;
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
      return `  ! ${p.text}${p.detail ? `\n${p.detail.replace(/^/gm, "    ")}` : ""}`;
    case "changes":
      return `  ± ${p.files.length}${p.more ? `+${p.more}` : ""} uncommitted in ${p.cwd}: ${p.files
        .slice(0, 8)
        .map((f) => `${f.status} ${f.path}${f.added !== undefined ? ` +${f.added}/-${f.removed}` : ""}`)
        .join(", ")}`;
    case "input":
      return p.state === "pending"
        ? `  ? ${p.prompt}${p.detail ? `\n    ${p.detail}` : ""}${p.options?.length ? `\n    options: ${p.options.join(" / ")}` : ""}\n    answer: apx runs respond ${p.input_id} ${p.kind === "confirm" ? "approve|deny" : '"<text>"'}`
        : `  ? ${p.kind === "confirm" ? "confirmation" : "question"} ${p.state}${p.answer ? `: ${p.answer}` : ""}`;
    default:
      return undefined;
  }
}

export async function chat(client: ApxClient, text: string, o: ChatOptions): Promise<void> {
  // Run inside an agent's command, its words would reach the other agent as the owner's, past every check: agents ask
  // with delegate, whose answer comes back to them (DECISIONS.md#d-127).
  if (process.env.APX_AGENT !== undefined)
    throw new Error(
      "apx chat speaks as the owner, so it does not run inside an agent's command. To ask another agent, use your delegate tool: its answer comes back to you, in one session per agent.",
    );
  if (!text) throw new Error('usage: apx chat "<text>" [--agent <id> | --thread <id>] [--new] [--detach]');
  const thread = await pickThread(client, o);
  const socket = await client.connect();
  try {
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
        // A turn that ran out of steps completed without finishing: said so in its end line.
        const end = e.run.end_reason === "step_limit" ? `${e.run.state} (out of steps)` : e.run.state;
        if (e.run.ended_at) early.set(e.run.id, end);
        if (e.run.id === runId && e.run.ended_at) finish(end);
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
      return;
    }
    runId = sent.run.id;
    if (o.detach) {
      console.log(`sent · run ${runId} · thread ${thread}`);
      return;
    }
    const endedEarly = early.get(runId);
    if (endedEarly) finish(endedEarly);
    const state = await Promise.race([
      done,
      socket.closed.then(() => {
        throw new Error("socket closed before the run ended");
      }),
    ]);
    const { messages } = await socket.call("threads.get", { thread });
    const answer = messages.filter((m) => m.run_id === runId).at(-1);
    const textPart = answer?.parts.findLast((p) => p.type === "text");
    if (textPart?.type === "text") console.log(`\n${textPart.text}`);
    console.log(`— ${state}${answer?.model ? ` · ${answer.model}` : ""} · thread ${thread}`);
    if (!state.startsWith("completed")) process.exitCode = 1;
  } finally {
    socket.close();
  }
}
