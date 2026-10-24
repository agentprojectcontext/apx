// A chat in a project keeps its temporary files apart: in a temp folder of its own, outside the project and APX's home,
// where writing never waits for the owner, even with outside content in the turn.
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";
import type { Message } from "@apx/protocol";
import { z } from "zod";
import { callTool, say, scriptedLlm, startCore } from "../engine/testkit.ts";
import { realpath } from "../paths.ts";
import { removeDir } from "../testkit/platform.ts";
import { scratchRoot } from "./folders.ts";
import { untrusted } from "./result.ts";
import { defineTool } from "./types.ts";

const readPage = defineTool({
  name: "read_page",
  description: "test tool",
  args: z.object({}),
  effect: "none",
  deadlineMs: 5_000,
  title: () => "Read a page",
  run: async () => untrusted("web_page", { url: "https://example.com" }, "Some numbers: 1, 2, 3."),
});

/** The temp folder the prompt names. */
let named = "";
const llm = scriptedLlm(async (req) => {
  const system = String(req.messages[0]?.content ?? "");
  named = /your temp folder, (\S+), never/.exec(system)?.[1] ?? "";
  const lastUser = req.messages.findLastIndex((m) => m.role === "user");
  const said = String(req.messages[lastUser]?.content ?? "");
  const done = req.messages.slice(lastUser).filter((m) => m.role === "tool").length;
  const steps = said.includes("someone else's")
    ? [{ name: "file_write", args: { path: path.join(scratchRoot(env.home), "other-chat", "x.txt"), content: "x" } }]
    : [
        { name: "read_page", args: {} },
        { name: "file_write", args: { path: path.join(named, "numbers.py"), content: "print(1 + 2 + 3)\n" } },
        { name: "shell", args: { command: "pwd && ls", cwd: named } },
        { name: "send_file", args: { path: path.join(named, "numbers.py") } },
      ];
  const next = steps[done];
  return next ? callTool(`c${done}`, next.name, next.args) : say(String(req.messages.at(-1)?.content ?? ""));
});

let env: Awaited<ReturnType<typeof startCore>>;
let root = "";
let agent = "";
before(async () => {
  env = await startCore({ llm, extraTools: [readPage] });
  root = realpath(fs.mkdtempSync(path.join(os.tmpdir(), "apx-scratch-project-")));
  fs.mkdirSync(path.join(root, ".apc", "agents"), { recursive: true });
  fs.writeFileSync(path.join(root, ".apc", "project.json"), JSON.stringify({ name: "Northwind" }));
  fs.writeFileSync(
    path.join(root, ".apc", "agents", "steady.md"),
    "---\nname: Steady\nrole: tester\nautonomy: standard\n---\n\nYou help.\n",
  );
  await env.client.call("projects.register", { path: root });
  agent = (await env.client.call("agents.list", {})).agents.find((a) => a.name === "Steady")?.id ?? "";
});
after(async () => {
  await env.core.close();
  await env.cleanup();
  await removeDir(root);
});

const asked = (messages: Message[]) =>
  messages.flatMap((m) => m.parts.flatMap((p) => (p.type === "input" && p.kind === "confirm" ? [p.tool] : [])));

test("a project chat writes, runs and sends its temporary files from its temp folder, never the project's", async () => {
  const project = (await env.client.call("projects.list", {})).projects.find((p) => p.path === root)?.id;
  const t = await env.client.call("threads.create", { kind: "loose", agent_id: agent, project_id: project });
  await env.client.call("threads.send", { thread: t.id, text: "add up the page's numbers" });
  const { messages, runs } = await env.settle(t.id);
  assert.equal(runs[0]?.state, "completed");
  assert.deepEqual(asked(messages), []);
  assert.equal(named, path.join(scratchRoot(env.home), t.id));
  assert.ok(!named.startsWith(env.home) && !named.startsWith(root));
  assert.equal(fs.readFileSync(path.join(named, "numbers.py"), "utf8"), "print(1 + 2 + 3)\n");
  assert.deepEqual(fs.readdirSync(root), [".apc"]);
  const parts = messages.flatMap((m) => m.parts);
  assert.ok(parts.some((p) => p.type === "file" && p.name === "numbers.py"));
  const changes = parts.filter((p) => p.type === "changes");
  assert.equal(changes.length, 1, "temp files are shown, apart from the owner's changes");
  assert.ok(changes[0]?.type === "changes" && changes[0].scratch && changes[0].edits);
  assert.equal(changes[0]?.type === "changes" && changes[0].cwd, named);
  assert.deepEqual(changes[0]?.type === "changes" && changes[0].files.map((f) => [f.path, f.status, f.added]), [
    ["numbers.py", "A", 1],
  ]);
  const ran = env.core.store.runs.steps(runs[0]?.id ?? "").find((s) => s.tool === "shell");
  assert.match(String(ran?.result ?? ""), /numbers\.py/);
});

test("another chat's temp folder is out of reach", async () => {
  const t = await env.client.call("threads.create", { kind: "loose", agent_id: agent });
  await env.client.call("threads.send", { thread: t.id, text: "write in someone else's folder" });
  const { messages } = await env.settle(t.id);
  assert.match(String(messages.at(-1)?.parts.find((p) => p.type === "text")?.text), /refused: .* outside the folder/);
  assert.ok(!fs.existsSync(path.join(scratchRoot(env.home), "other-chat")));
});
