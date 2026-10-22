// An OpenAI-compatible model on localhost: it answers at once and always the same way, so a test can read the reply
// ("Got it: <the last line you wrote>"). Streams like a real one when asked. It calls two tools: "start a worker"
// delegates to a worker, which answers with a long report ("start two workers" delegates twice in one turn, "start a
// worker in <project id>" into that project, "start four slow workers" four at once, each taking a few seconds, so one
// waits for a slot; "start a worker and keep going" hands one off and takes a while to answer, so the worker's result
// waits behind that turn); "make a note file" runs a command that needs the owner's OK; "look around the parent
// folder" reads outside the project's folder (a folder card); "show a widget" makes one; "open a
// report" writes one and opens it as a document; "show a table for task_…" answers with a wide table whose last
// column holds that task's chip. It also
// embeds texts (Ollama's /api/embed) for the skills picked by meaning.
import http from "node:http";
import type { AddressInfo } from "node:net";

type Message = { role: string; content?: unknown };

/** The owner's words in the last user message, without the framing APX puts around them. */
function lastWords(messages: Message[]): string {
  const last = [...messages].reverse().find((m) => m.role === "user");
  const text =
    typeof last?.content === "string"
      ? last.content
      : Array.isArray(last?.content)
        ? last.content.map((p) => (p as { text?: string }).text ?? "").join("\n")
        : "";
  const lines = text
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith("[") && !l.startsWith("<") && !l.startsWith("(This is"));
  return (lines.at(-1) ?? "").slice(0, 160);
}

/** Embeddings, Ollama-style: pictures point one way, anything else (each a bit apart) another. */
function vectorOf(text: string): number[] {
  if (/image|imagen|picture|dibujo/i.test(text)) return [1, 0, 0, 0.2];
  return [0.05 * (text.length % 5), 0.05 * (text.length % 3), 1, 0];
}

/** The report a worker hands back: long enough to fold. */
const REPORT = [
  "## Report",
  ...Array.from({ length: 14 }, (_, i) => `- Source ${i + 1}: checked, still current.`),
  "Last line of the report.",
].join("\n");

/** An answer with a shell block the owner can run from the chat. */
const SUGGESTION = "Run this in the project:\n\n```bash\necho e2e-suggested-$((6*7))\n```";

/** A review table like an agent's: short columns first, a task chip and long text in the last one. */
function reviewTable(said: string): string | undefined {
  const m = /^show a table(?: for (task_[0-9a-f]+))?/i.exec(said);
  if (!m) return undefined;
  const task = m[1] ? `\`${m[1]}\`` : "a task";
  return [
    "I reviewed the open issues:",
    "",
    "| Issue | Classification | Priority | Assigned agent | Result |",
    "|---|---|:---:|---|---|",
    `| #112 | Confirmed bug | High | Fausto | Created ${task}, with the steps to reproduce it and the logs from the last three runs |`,
    "| #113 | Question | Low | Roby | Answered in the thread with a link to the routines guide |",
    "| #114 | Duplicate | Low | Roby | Closed as a duplicate of #112 |",
  ].join("\n");
}

/** How long a slow worker takes to answer. */
const SLOW_MS = 2500;
/** How long a caller that handed work off keeps its turn going ("start a worker and keep going"). */
const KEEP_GOING_MS = 10_000;
const KEEP_GOING = /^start a worker and keep going/i;

/** Four delegations in one step: past the three at once from a thread, the fourth is queued. */
function fanOut(messages: Message[], said: string): Array<{ name: string; arguments: string }> | undefined {
  if (!/^start four slow workers/i.test(said) || messages.at(-1)?.role === "tool") return undefined;
  const worker = { name: "Slow researcher", instructions: "Check the part you are given." };
  return [1, 2, 3, 4].map((n) => ({
    name: "delegate",
    arguments: JSON.stringify({ worker, task: `check part ${n}`, wait_s: 0 }),
  }));
}

/** A tool call to make instead of answering, if the conversation asks for one. */
function toolCall(messages: Message[], said: string): { name: string; arguments: string } | undefined {
  if (/^read MCP twice/i.test(said)) {
    const last = messages.at(-1);
    if (last?.role !== "tool") return { name: "mcp_notes_echo", arguments: JSON.stringify({ text: "first" }) };
    if (String(last.content).includes("echo: first"))
      return { name: "mcp_notes_echo", arguments: JSON.stringify({ text: "second" }) };
    return undefined;
  }
  // A report written, then opened as a document.
  if (/^open a report/i.test(said)) {
    const sinceOwner = messages.slice(messages.findLastIndex((m) => m.role === "user"));
    const done = sinceOwner.filter((m) => m.role === "tool").length;
    if (done === 0)
      return { name: "file_write", arguments: JSON.stringify({ path: "notes/report.md", content: "# Quarter\n" }) };
    if (done === 1)
      return { name: "open_document", arguments: JSON.stringify({ path: "notes/report.md", title: "Quarter report" }) };
    return undefined;
  }
  const worker = { name: "Researcher", instructions: "Check every source and list it." };
  const delegate = { name: "delegate", arguments: JSON.stringify({ worker, task: "check the sources" }) };
  // Two delegations in one turn, the second after the first's result: past a one-turn limit the breaker refuses it.
  if (/^start two workers/i.test(said)) {
    const sinceOwner = messages.slice(messages.findLastIndex((m) => m.role === "user"));
    return sinceOwner.filter((m) => m.role === "tool").length < 2 ? delegate : undefined;
  }
  if (messages.at(-1)?.role === "tool") return undefined;
  if (KEEP_GOING.test(said))
    return {
      name: "delegate",
      arguments: JSON.stringify({
        worker: { name: "Scout", instructions: "Check the sources quickly." },
        task: "check the sources",
        wait_s: 0,
      }),
    };
  if (/^show a widget/i.test(said))
    return {
      name: "show_widget",
      arguments: JSON.stringify({ name: "e2e-coverage", title: "Coverage audit", html: "<h1>Coverage rows</h1>" }),
    };
  // A first look past the project's folder: a folder card asks the owner.
  if (/^look around the parent folder/i.test(said))
    return { name: "shell", arguments: JSON.stringify({ command: "pwd; ls .." }) };
  // A write in a folder of the owner's own choosing, outside every folder of the chat.
  const outside = /^write a note at (\S+)/i.exec(said);
  if (outside) return { name: "shell", arguments: JSON.stringify({ command: `echo note > ${outside[1]}` }) };
  // A command that writes: the owner is asked first.
  if (/^make a note file/i.test(said))
    return { name: "shell", arguments: JSON.stringify({ command: "touch e2e-note.txt" }) };
  // A question with several answers to tick.
  if (/^ask me which days/i.test(said))
    return {
      name: "ask_owner",
      arguments: JSON.stringify({
        question: "Which days work for the **Northwind** review?",
        options: ["Monday", "Tuesday", "Wednesday"],
        multi: true,
      }),
    };
  // An edit of AGENTS.md: always asked, with the patch it would make.
  if (/^edit the agents file/i.test(said))
    return {
      name: "file_edit",
      arguments: JSON.stringify({
        path: "AGENTS.md",
        old: "The Acme storefront.",
        new: "The Acme storefront, rebuilt.",
      }),
    };
  // "start a worker in <project id>": the worker's chat is linked to that project.
  const into = /^start a worker in (\S+)/i.exec(said);
  if (into)
    return {
      name: "delegate",
      arguments: JSON.stringify({ worker, task: "check the project sources", project: into[1] }),
    };
  return /^start a worker/i.test(said) ? delegate : undefined;
}

export async function fakeLlm() {
  const calls: Array<{ model: string; said: string }> = [];
  const server = http.createServer((req, res) => {
    let raw = "";
    req.on("data", (c) => {
      raw += c;
    });
    req.on("end", () => {
      if (req.url?.endsWith("/models")) {
        res.writeHead(200, { "content-type": "application/json" });
        return res.end(JSON.stringify({ data: [{ id: "fake-1", object: "model" }] }));
      }
      if (req.url === "/api/tags" || req.url === "/api/embed") {
        res.writeHead(200, { "content-type": "application/json" });
        if (req.url === "/api/tags")
          return res.end(JSON.stringify({ models: [{ name: "qwen3:4b" }, { name: "embeddinggemma:300m" }] }));
        const { input } = JSON.parse(raw) as { input: string[] };
        return res.end(JSON.stringify({ embeddings: input.map(vectorOf) }));
      }
      const body = (raw ? JSON.parse(raw) : {}) as { model?: string; messages?: Message[]; stream?: boolean };
      const said = lastWords(body.messages ?? []);
      calls.push({ model: body.model ?? "", said });
      const system = String(body.messages?.[0]?.content ?? "");
      const slow = system.startsWith("You are Slow researcher, a worker");
      const text = system.startsWith("You are Researcher, a worker")
        ? REPORT
        : slow
          ? "Part checked."
          : /^suggest a command/i.test(said)
            ? SUGGESTION
            : (reviewTable(said) ?? `Got it: ${said || "(nothing)"}`);
      const usage = { prompt_tokens: 120, completion_tokens: 8, total_tokens: 128 };
      const call = toolCall(body.messages ?? [], said);
      const wanted = fanOut(body.messages ?? [], said) ?? (call ? [call] : undefined);
      if (wanted) {
        const tool_calls = wanted.map((c, i) => ({ id: `call-${calls.length}-${i}`, type: "function", function: c }));
        if (!body.stream) {
          res.writeHead(200, { "content-type": "application/json" });
          return res.end(
            JSON.stringify({
              id: "fake",
              choices: [
                { index: 0, message: { role: "assistant", content: null, tool_calls }, finish_reason: "tool_calls" },
              ],
              usage,
            }),
          );
        }
        res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache" });
        const delta = { tool_calls: tool_calls.map((c, index) => ({ index, ...c })) };
        res.write(`data: ${JSON.stringify({ id: "fake", choices: [{ index: 0, delta, finish_reason: null }] })}\n\n`);
        res.write(
          `data: ${JSON.stringify({ id: "fake", choices: [{ index: 0, delta: {}, finish_reason: "tool_calls" }] })}\n\n`,
        );
        res.write(`data: ${JSON.stringify({ id: "fake", choices: [], usage })}\n\n`);
        return res.end("data: [DONE]\n\n");
      }
      const answer = () => {
        if (!body.stream) {
          res.writeHead(200, { "content-type": "application/json" });
          return res.end(
            JSON.stringify({
              id: "fake",
              choices: [{ index: 0, message: { role: "assistant", content: text }, finish_reason: "stop" }],
              usage,
            }),
          );
        }
        res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache" });
        const send = (o: unknown) => res.write(`data: ${JSON.stringify(o)}\n\n`);
        for (const part of text.match(/[\s\S]{1,12}/g) ?? [text])
          send({ id: "fake", choices: [{ index: 0, delta: { content: part }, finish_reason: null }] });
        send({ id: "fake", choices: [{ index: 0, delta: {}, finish_reason: "stop" }] });
        send({ id: "fake", choices: [], usage });
        res.end("data: [DONE]\n\n");
      };
      const keepGoing = KEEP_GOING.test(said) && body.messages?.at(-1)?.role === "tool";
      if (slow || keepGoing) setTimeout(answer, slow ? SLOW_MS : KEEP_GOING_MS);
      else answer();
    });
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  return {
    url: `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1`,
    calls,
    close: () => new Promise<void>((r) => server.close(() => r())),
  };
}
