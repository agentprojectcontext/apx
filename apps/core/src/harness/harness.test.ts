import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";
import { ApxError } from "@apx/protocol/client";
import { say, scriptedLlm, startCore, texts } from "../engine/testkit.ts";
import { realpath } from "../paths.ts";
import { removeDir } from "../testkit/platform.ts";
import { scratchRoot } from "../tools/folders.ts";
import type { Harness, TurnIO } from "./index.ts";

/** A path as a command names it: forward slashes, which Git Bash reads on Windows too. */
const sh = (p: string) => p.split(path.sep).join("/");

const seen: Array<{ harness: string; io: TurnIO; outside: boolean }> = [];
const fake = (id: "claude" | "codex"): Harness => ({
  id,
  async run(io) {
    seen.push({ harness: id, io, outside: io.outside() });
    // "probe [...]" asks the core about each of its own tool calls, as Claude Code's canUseTool does.
    const probe = /^probe (.*)$/s.exec(String(io.input.content).split("\n").at(-1) ?? "");
    if (probe) {
      const asked = JSON.parse(probe[1] ?? "[]") as Array<{ kind: string; path?: string; command?: string }>;
      const said: boolean[] = [];
      for (const [i, a] of asked.entries()) {
        const input = a.command === undefined ? { path: a.path } : { command: a.command };
        said.push(await io.approve({ callId: `${io.run.id}-p${i}`, title: a.kind, kind: a.kind, input }));
      }
      return { text: JSON.stringify(said), model: `${id}/model`, sessionId: "probe" };
    }
    io.onText("thinking…");
    if (String(io.input.content).includes("search the web"))
      io.observe({ callId: `${io.run.id}-w`, title: "Searched news", kind: "fetch", status: "ok" });
    const r = await io.execute(`${io.run.id}-x1`, "show_widget", {
      name: "from-claude",
      title: "From Claude",
      html: "<i>hi</i>",
    });
    return {
      text: `widget ok=${r.ok}`,
      model: `${id}/model`,
      sessionId: `sess-${seen.length}`,
      usage: { input: 10, output: 5 },
    };
  },
});
// Like Codex: its session's running total at the end of each turn. Anything else fails after spending a little.
let codexTotal = 0;
const codex: Harness = {
  id: "codex",
  run: async (io) => {
    if (!String(io.input.content).includes("count")) {
      io.onUsage?.({ input: 7, output: 2 });
      throw new Error("usage limit reached");
    }
    codexTotal += 100;
    return {
      text: "counted",
      model: "codex/model",
      sessionId: "codex-sess",
      sessionUsage: { input: codexTotal, output: codexTotal / 10, cached: codexTotal / 2 },
    };
  },
};
const native = scriptedLlm(() => say("native answer"));

let env: Awaited<ReturnType<typeof startCore>>;
before(async () => {
  env = await startCore({ llm: native, harnesses: { claude: fake("claude"), codex } });
});
after(async () => {
  await env.core.close();
  await env.cleanup();
});

/** A Claude Code or Codex session of the owner's, in a fresh project folder. */
async function session(engine: "claude" | "codex") {
  const repo = realpath(fs.mkdtempSync(path.join(os.tmpdir(), "apx-harness-")));
  const project = (await env.client.call("projects.register", { path: repo, init: true })).project.id;
  return env.client.call("threads.create", { kind: "code", agent_id: "roby", project_id: project, engine });
}

test("a Claude Code session runs there, with APX tools, cards, usage and its own session kept", async () => {
  const t0 = await session("claude");
  await env.client.call("threads.send", { thread: t0.id, text: "hello" });
  const t = await env.settle(t0.id);
  const answer = t.messages.at(-1);
  assert.equal(answer?.model, "claude/model");
  assert.ok(answer?.parts.some((p) => p.type === "tool" && p.tool === "show_widget" && p.status === "ok"));
  assert.ok(answer?.parts.some((p) => p.type === "text" && p.text === "widget ok=true"));
  assert.equal(t.runs[0]?.harness, "claude");
  assert.deepEqual(t.runs[0]?.usage, { input: 10, output: 5 });
  assert.match(seen.at(-1)?.io.system ?? "", /running inside APX/);
  await env.client.call("threads.send", { thread: t0.id, text: "again" });
  await env.settle(t0.id);
  assert.equal(seen.at(-1)?.io.sessionId, "sess-1");
  // Its tool calls left step records like the native loop's.
  assert.equal(env.core.store.runs.steps(t.runs[0]?.id ?? "")[0]?.tool, "show_widget");
});

test("a CLI is never an agent's model, the router or the install default; one saved by an older APX is skipped", async () => {
  for (const bad of ["claude", "codex/gpt-x"]) {
    const asRouter = await env.client
      .call("models.set_config", { router: { rules: [], chain: [bad] } })
      .catch((e: unknown) => e);
    assert.ok(asRouter instanceof ApxError && /own sessions/.test(asRouter.message), bad);
    const asDefault = await env.client
      .call("models.set_config", { default: { model: bad, router: false } })
      .catch((e: unknown) => e);
    assert.ok(asDefault instanceof ApxError && asDefault.code === "bad_request", bad);
    const asAgent = await env.client
      .call("agents.update", { agent: "roby", model_choice: { model: bad, router: false } })
      .catch((e: unknown) => e);
    assert.ok(asAgent instanceof ApxError && asAgent.code === "bad_request", bad);
    const inChat = await env.client
      .call("threads.model", { thread: "home", model_choice: { model: bad, router: false } })
      .catch((e: unknown) => e);
    assert.ok(inChat instanceof ApxError && inChat.code === "bad_request", bad);
  }
  // As an older APX saved them: the router and the default name CLIs; the turn runs on the model API behind them.
  env.core.store.settings.write("model_default", { model: "claude", router: true });
  env.core.store.settings.write("model_router", {
    rules: [{ when: {}, model: "codex" }],
    chain: ["codex", "fake/fake-1"],
  });
  const config = await env.client.call("models.config", {});
  assert.deepEqual(config, { default: { router: true }, router: { rules: [], chain: ["fake/fake-1"] } });
  const { engines } = await env.client.call("engines.status", {});
  assert.equal(engines.find((e) => e.default)?.id, "native");
  const before_ = seen.length;
  await env.client.call("threads.send", { thread: "home", text: "who answers?" });
  const t = await env.settle("home");
  assert.equal(seen.length, before_, "no CLI ran");
  assert.equal(texts(t.messages).at(-1), "native answer");
  assert.equal(t.runs[0]?.harness, "native");
});

test("an engine session runs its own CLI only: another engine's model is refused there", async () => {
  const t = await session("claude");
  for (const other of ["fake/fake-1", "codex"]) {
    const err = await env.client
      .call("threads.model", { thread: t.id, model_choice: { model: other, router: false } })
      .catch((e: unknown) => e);
    assert.ok(err instanceof ApxError && err.code === "bad_request", other);
  }
  await env.client.call("threads.model", { thread: t.id, model_choice: { model: "claude/opus", router: false } });
  const before_ = seen.length;
  await env.client.call("threads.send", { thread: t.id, text: "hello" });
  const done = await env.settle(t.id);
  assert.equal(seen.length, before_ + 1);
  assert.deepEqual(seen.at(-1)?.io.models, ["claude/opus"]);
  assert.equal(seen.at(-1)?.io.input.content, "hello", "the owner's words as they are");
  assert.equal(done.runs[0]?.harness, "claude");
});

test("a CLI that fails in its session fails the turn: no other engine answers for it", async () => {
  const t = await session("codex");
  await env.client.call("threads.send", { thread: t.id, text: "hello" });
  const done = await env.settle(t.id);
  assert.equal(done.runs[0]?.state, "failed");
  assert.equal(done.runs[0]?.harness, "codex");
  assert.ok(!texts(done.messages).includes("native answer"));
  // What it spent before failing is kept.
  assert.deepEqual(done.runs[0]?.usage, { input: 7, output: 2 });
});

test("an engine that reports its session's running total gets each turn's own share", async () => {
  const t = await session("codex");
  await env.client.call("threads.send", { thread: t.id, text: "count" });
  await env.settle(t.id);
  await env.client.call("threads.send", { thread: t.id, text: "count again" });
  const done = await env.settle(t.id);
  const share = { input: 100, output: 10, cached: 50 };
  assert.deepEqual(
    done.runs.map((r) => r.usage),
    [share, share],
  );
  assert.equal(env.core.store.harnessSessions.total(t.id, "codex", "codex-sess")?.input, 200);
});

test("a model ref nothing can run is refused when it is set", async () => {
  for (const bad of ["fake", "nope/x"]) {
    const err = await env.client
      .call("models.set_config", { router: { rules: [], chain: [bad] } })
      .catch((e: unknown) => e);
    assert.ok(err instanceof ApxError && err.code === "bad_request", bad);
  }
  const err = await env.client
    .call("agents.update", { agent: "roby", model_choice: { model: "nope/x", router: false } })
    .catch((e: unknown) => e);
  assert.ok(err instanceof ApxError && err.code === "bad_request");
});

test("harness tool gates refuse unknown tokens", async () => {
  const err = await env.client.call("harness.tools", { token: "x".repeat(48) }).catch((e: unknown) => e);
  assert.ok(err instanceof ApxError);
  assert.equal(err.code, "unauthorized");
});

test("the per-run MCP proxy (used by Codex) lists and calls that run's tools through the core", async () => {
  const { Client } = await import("@modelcontextprotocol/sdk/client/index.js");
  const { StdioClientTransport } = await import("@modelcontextprotocol/sdk/client/stdio.js");
  const calls: Array<[string, Record<string, unknown>]> = [];
  const token = env.core.harnesses.openGate({
    run: { id: "run_test" } as TurnIO["run"],
    tools: [
      {
        type: "function",
        function: { name: "ping", description: "test", parameters: { type: "object", properties: {} } },
      },
    ],
    execute: async (_id, name, args) => {
      calls.push([name, args]);
      return { ok: true, text: "pong" };
    },
  });
  const terminal = path.resolve(import.meta.dirname, "../../../terminal/src/main.ts");
  const mcp = new Client({ name: "test", version: "0" });
  await mcp.connect(
    new StdioClientTransport({
      command: process.execPath,
      args: [terminal, "mcp", "--run"],
      env: { ...process.env, APX_URL: env.core.url, APX_RUN_TOKEN: token } as Record<string, string>,
    }),
  );
  const { tools } = await mcp.listTools();
  assert.deepEqual(
    tools.map((t) => t.name),
    ["ping"],
  );
  const r = await mcp.callTool({ name: "ping", arguments: { x: 1 } });
  assert.deepEqual(r.content, [{ type: "text", text: "pong" }]);
  assert.deepEqual(calls, [["ping", { x: 1 }]]);
  env.core.harnesses.closeGate(token);
  const gone = await mcp.callTool({ name: "ping", arguments: {} });
  assert.equal(gone.isError, true);
  await mcp.close();
});

test("Claude Code gets each tool's real schema: arrays stay arrays, limits stay limits", async () => {
  const { zodShape } = await import("./claude.ts");
  const { ownerTools } = await import("../tools/owner.ts");
  const { toSpec } = await import("../tools/types.ts");
  const ask = ownerTools(env.core.store).find((t) => t.name === "ask_owner");
  assert.ok(ask);
  const { z } = await import("zod");
  const schema = z.object(zodShape(toSpec(ask).function.parameters));
  assert.ok(schema.safeParse({ question: "Which?", options: ["red", "blue"] }).success);
  assert.ok(!schema.safeParse({ question: "Which?", options: "red, blue" }).success);
  assert.ok(!schema.safeParse({ question: "" }).success);
});

test("Claude Code reads the folder's CLAUDE.md through APX, never through a link", async () => {
  const { folderClaudeMd } = await import("./claude.ts");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "apx-claude-md-"));
  assert.equal(folderClaudeMd(dir), "");
  fs.writeFileSync(path.join(dir, "CLAUDE.md"), "Use pnpm.");
  assert.match(folderClaudeMd(dir), /CLAUDE\.md\n\nUse pnpm\.$/);
  fs.rmSync(path.join(dir, "CLAUDE.md"));
  fs.writeFileSync(path.join(dir, "secret.txt"), "private");
  fs.symlinkSync(path.join(dir, "secret.txt"), path.join(dir, "CLAUDE.md"));
  assert.equal(folderClaudeMd(dir), "");
  await removeDir(dir);
});

test("what an engine session read from outside stays with it: its next turns start untrusted", async () => {
  const t0 = await session("claude");
  await env.client.call("threads.send", { thread: t0.id, text: "hello" });
  await env.settle(t0.id);
  assert.equal(seen.at(-1)?.outside, false);
  await env.client.call("threads.send", { thread: t0.id, text: "search the web please" });
  await env.settle(t0.id);
  await env.client.call("threads.send", { thread: t0.id, text: "now fix the file" });
  await env.settle(t0.id);
  assert.equal(seen.at(-1)?.outside, true);
});

test("Codex writes in an auto code chat in auto, accept edits and total, whatever the session read; never in manual or plan; total writes in any chat but a read-only one", async () => {
  const { codexWrites } = await import("./codex.ts");
  const thread = { cwd: "/work/acme", write: "auto" } as unknown as TurnIO["thread"];
  const io = (autonomy: string, outside: boolean) =>
    ({ thread, agent: { autonomy }, outside: () => outside }) as unknown as TurnIO;
  assert.equal(codexWrites(io("auto", false)), true);
  assert.equal(codexWrites(io("auto", true)), true, "outside content only gates strong actions");
  assert.equal(codexWrites(io("manual", false)), false);
  assert.equal(codexWrites(io("plan", false)), false);
  assert.equal(codexWrites(io("total", true)), true);
  assert.equal(codexWrites(io("accept_edits", true)), true);
  // Codex never asks: a chat that asks before writing stays read-only, except in total, where nothing waits.
  assert.equal(codexWrites({ ...io("total", false), thread: { ...thread, write: "ask" } } as TurnIO), true);
  assert.equal(codexWrites({ ...io("auto", false), thread: { ...thread, write: "ask" } } as TurnIO), false);
  assert.equal(codexWrites({ ...io("total", false), thread: { ...thread, write: "read-only" } } as TurnIO), false);
});

test("an external session gets an owner's attachment in its temp folder despite omitting agent framing", async () => {
  const thread = await session("claude");
  const bytes = Buffer.from("%PDF-1.4\nreceipt\n%%EOF");
  const { media } = await env.client.call("media.upload", {
    name: "receipt.pdf",
    mime: "application/pdf",
    data: bytes.toString("base64"),
    thread: thread.id,
  });
  await env.client.call("threads.send", { thread: thread.id, text: "Read this", attachments: [media.id] });
  await env.settle(thread.id);
  const input = seen.at(-1)?.io.input.content ?? "";
  const file = /File in your temp folder: (.+)\. Use/.exec(input)?.[1];
  assert.ok(file, input);
  assert.equal(
    path.relative(path.join(scratchRoot(env.home), thread.id), file).startsWith(`attachments${path.sep}`),
    true,
  );
  assert.deepEqual(fs.readFileSync(file), bytes);
});

test("an outside agent reads its project's read-only folders without asking and may never change them", async () => {
  const t0 = await session("claude");
  const ref = realpath(fs.mkdtempSync(path.join(os.tmpdir(), "apx-ref-")));
  await env.client.call("projects.update", { project: t0.project_id ?? "", read_only_folders: [ref] });
  const asks = [
    { kind: "read", path: path.join(ref, "a.ts") },
    { kind: "search", path: ref },
    { kind: "edit", path: path.join(ref, "a.ts") },
    { kind: "delete", path: path.join(ref, "a.ts") },
  ];
  await env.client.call("threads.send", { thread: t0.id, text: `probe ${JSON.stringify(asks)}` });
  const t = await env.settle(t0.id);
  const answer = t.messages.at(-1)?.parts.find((p) => p.type === "text");
  assert.equal(answer?.type === "text" ? answer.text : "", "[true,true,false,false]");
  await removeDir(ref);
});

test("an outside agent's commands follow the shell tool's folder rule and reach: total reads and writes anywhere, never a read-only folder", async () => {
  const t0 = await session("claude");
  const ref = realpath(fs.mkdtempSync(path.join(os.tmpdir(), "apx-ref-")));
  const away = realpath(fs.mkdtempSync(path.join(os.tmpdir(), "apx-away-")));
  await env.client.call("projects.update", { project: t0.project_id ?? "", read_only_folders: [ref] });
  // Total autonomy: nothing is put to the owner, so only the folder rule says no.
  await env.client.call("agents.update", { agent: "roby", autonomy: "total" });
  try {
    const commands: Array<[string, boolean]> = [
      [`cat ${sh(ref)}/a.ts`, true],
      [`cp ${sh(ref)}/a.ts ./a.ts`, true],
      [`git -C ${sh(ref)} log --oneline`, true],
      ["ls", true],
      [`touch ${sh(ref)}/x`, false],
      [`cp a.ts ${sh(ref)}/a.ts`, false],
      [`cd ${sh(ref)} && npm install`, false],
      [`echo x > $(echo ${sh(ref)})/y`, false],
      // Total reaches every folder but APX's own, through Claude Code's tools as through ours (DECISIONS.md#d-115).
      [`cat ${sh(away)}/secret.txt`, true],
      [`touch ${sh(away)}/made.txt`, true],
      [`cat ${sh(env.home)}/apx.db`, false],
    ];
    const asks = commands.map(([command]) => ({ kind: "execute", command }));
    await env.client.call("threads.send", { thread: t0.id, text: `probe ${JSON.stringify(asks)}` });
    const t = await env.settle(t0.id);
    const answer = t.messages.at(-1)?.parts.find((p) => p.type === "text");
    const said = JSON.parse(answer?.type === "text" ? answer.text : "[]") as boolean[];
    for (const [i, [command, allowed]] of commands.entries()) assert.equal(said[i], allowed, command);
  } finally {
    await env.client.call("agents.update", { agent: "roby", autonomy: null });
    await env.client.call("projects.update", { project: t0.project_id ?? "", read_only_folders: [] });
    await removeDir(ref);
    await removeDir(away);
  }
});
