import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";
import { say, scriptedLlm, startCore } from "../engine/testkit.ts";
import type { Harness, TurnIO } from "../harness/types.ts";
import { realpath } from "../paths.ts";
import { removeDir } from "../testkit/platform.ts";

const seen: TurnIO[] = [];
const claude: Harness = {
  id: "claude",
  async run(io) {
    seen.push(io);
    io.onText("Picking up where we left off.");
    return { text: "Picking up where we left off.", model: "claude/default", sessionId: io.sessionId };
  },
};

let env: Awaited<ReturnType<typeof startCore>>;
let repo = "";
const line = (o: unknown) => `${JSON.stringify(o)}\n`;

before(async () => {
  env = await startCore({ llm: scriptedLlm(() => say("ok")), harnesses: { claude } });
  repo = realpath(fs.mkdtempSync(path.join(os.tmpdir(), "apx-native-")));
  fs.writeFileSync(path.join(repo, "AGENTS.md"), "# Acme\n");
  const claudeDir = path.join(env.home, "claude-home", "projects", "-work-acme");
  fs.mkdirSync(claudeDir, { recursive: true });
  fs.writeFileSync(
    path.join(claudeDir, "s-mine.jsonl"),
    line({
      type: "user",
      cwd: repo,
      sessionId: "s-mine",
      message: { role: "user", content: "<command-name>/clear</command-name>" },
    }) +
      line({ type: "user", cwd: repo, sessionId: "s-mine", message: { role: "user", content: "Fix the login form" } }) +
      line({
        type: "assistant",
        sessionId: "s-mine",
        message: {
          role: "assistant",
          content: [
            { type: "text", text: "Fixed: the button was disabled." },
            { type: "tool_use", id: "t1", name: "Edit", input: {} },
          ],
        },
      }) +
      line({ type: "custom-title", customTitle: "Login form", sessionId: "s-mine" }),
  );
  // A turn APX itself ran on Claude Code for an agent: not one of the owner's sessions.
  fs.writeFileSync(
    path.join(claudeDir, "s-apx.jsonl"),
    line({ type: "user", cwd: repo, message: { role: "user", content: "[context: Friday · channel: app]\nhello" } }),
  );
  const codexDir = path.join(env.home, "codex-home", "sessions", "2026", "10", "02");
  fs.mkdirSync(codexDir, { recursive: true });
  fs.writeFileSync(
    path.join(codexDir, "rollout-2026-10-02T10-00-00-c-mine.jsonl"),
    line({
      type: "session_meta",
      payload: { id: "c-mine", cwd: repo, originator: "Codex Desktop", source: "vscode" },
    }) +
      line({
        type: "response_item",
        payload: {
          type: "message",
          role: "user",
          content: [
            { type: "input_text", text: "# AGENTS.md instructions" },
            { type: "input_text", text: "Add a README" },
          ],
        },
      }) +
      line({
        type: "response_item",
        payload: { type: "message", role: "assistant", content: [{ type: "output_text", text: "README added." }] },
      }),
  );
  fs.writeFileSync(
    path.join(codexDir, "rollout-2026-10-02T11-00-00-c-sdk.jsonl"),
    line({ type: "session_meta", payload: { id: "c-sdk", cwd: repo, originator: "codex_sdk_ts", source: "exec" } }),
  );
});
after(async () => {
  await env.core.close();
  await env.cleanup();
  await removeDir(repo);
});

test("the owner's own sessions are listed, titled, without APX's own runs", async () => {
  const c = await env.client.call("sessions.native", { engine: "claude" });
  assert.deepEqual(
    c.sessions.map((s) => [s.id, s.title, s.cwd]),
    [["s-mine", "Login form", repo]],
  );
  const x = await env.client.call("sessions.native", { engine: "codex" });
  assert.deepEqual(
    x.sessions.map((s) => [s.id, s.title]),
    [["c-mine", "Add a README"]],
  );
});

test("going on with a session: Claude Code itself, in its folder, resuming its transcript; listed once", async () => {
  const t = await env.client.call("sessions.resume", { engine: "claude", id: "s-mine" });
  assert.equal(t.engine, "claude");
  assert.equal(t.cwd, repo);
  assert.equal(t.title, "Login form");
  const { messages } = await env.client.call("threads.get", { thread: t.id });
  assert.deepEqual(
    messages.map((m) => [m.author.kind, m.parts[0]?.type === "text" ? m.parts[0].text : ""]),
    [
      ["user", "Fix the login form"],
      ["agent", "Fixed: the button was disabled."],
    ],
  );
  // Asked again: the same chat, and the session is no longer offered.
  assert.equal((await env.client.call("sessions.resume", { engine: "claude", id: "s-mine" })).id, t.id);
  assert.deepEqual((await env.client.call("sessions.native", { engine: "claude" })).sessions, []);

  await env.client.call("threads.send", { thread: t.id, text: "now the signup form" });
  await env.settle(t.id);
  const io = seen.at(-1);
  assert.equal(io?.sessionId, "s-mine", "the engine resumes its own session");
  assert.equal(io?.input.content, "now the signup form", "the owner's words as they are, no agent framing");
  assert.doesNotMatch(String(io?.system), /Roby/, "no agent persona");
});

test("an engine session started in APX is a code thread set to that engine", async () => {
  const project = (await env.client.call("projects.register", { path: repo })).project.id;
  const t = await env.client.call("threads.create", {
    kind: "code",
    agent_id: "roby",
    project_id: project,
    engine: "codex",
  });
  assert.equal(t.engine, "codex");
  assert.deepEqual(t.model_choice, { model: "codex", router: false });
  const listed = (await env.client.call("threads.list", { engine: "codex" })).threads;
  assert.ok(listed.some((x) => x.id === t.id));
  // An agent's chat set to that engine's model is still the agent's chat, not an engine session.
  const chat = await env.client.call("threads.create", { kind: "loose", agent_id: "roby" });
  env.core.store.threads.mergeContext(chat.id, { model_choice: { model: "codex", router: false } });
  assert.ok(!(await env.client.call("threads.list", { engine: "codex" })).threads.some((x) => x.id === chat.id));
  assert.ok(listed.every((x) => x.engine === "codex"));
  await assert.rejects(env.client.call("threads.create", { kind: "loose", agent_id: "roby", engine: "codex" }));
});
