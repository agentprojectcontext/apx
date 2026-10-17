// An OpenAI-compatible model on localhost: it answers at once and always the same way, so a test can read the reply
// ("Got it: <the last line you wrote>"). Streams like a real one when asked. It calls two tools: "start a worker"
// delegates to a worker, which answers with a long report ("start two workers" delegates twice in one turn, "start a
// worker in <project id>" into that project); "make a note file" runs a command that needs the owner's OK. It also
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

/** A tool call to make instead of answering, if the conversation asks for one. */
function toolCall(messages: Message[], said: string): { name: string; arguments: string } | undefined {
  if (/^read MCP twice/i.test(said)) {
    const last = messages.at(-1);
    if (last?.role !== "tool") return { name: "mcp_notes_echo", arguments: JSON.stringify({ text: "first" }) };
    if (String(last.content).includes("echo: first"))
      return { name: "mcp_notes_echo", arguments: JSON.stringify({ text: "second" }) };
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
  // A command that writes: the owner is asked first.
  if (/^make a note file/i.test(said))
    return { name: "shell", arguments: JSON.stringify({ command: "touch e2e-note.txt" }) };
  // A question with several answers to tick.
  if (/^ask me which days/i.test(said))
    return {
      name: "ask_owner",
      arguments: JSON.stringify({
        question: "Which days work for the Northwind review?",
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
      const text = system.startsWith("You are Researcher, a worker")
        ? REPORT
        : /^suggest a command/i.test(said)
          ? SUGGESTION
          : `Got it: ${said || "(nothing)"}`;
      const usage = { prompt_tokens: 120, completion_tokens: 8, total_tokens: 128 };
      const call = toolCall(body.messages ?? [], said);
      if (call) {
        const tool_calls = [{ id: `call-${calls.length}`, type: "function", function: call }];
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
    });
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  return {
    url: `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1`,
    calls,
    close: () => new Promise<void>((r) => server.close(() => r())),
  };
}
