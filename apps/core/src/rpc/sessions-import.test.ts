import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { after, before, test } from "node:test";
import zlib from "node:zlib";
import { say, scriptedLlm, startCore } from "../engine/testkit.ts";

const PNG = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=";
const line = (o: unknown) => `${JSON.stringify(o)}\n`;
const at = (m: number) => `2026-09-01T10:${String(m).padStart(2, "0")}:00.000Z`;
const say_ = (role: "user" | "assistant", text: string, m: number, extra: unknown[] = []) =>
  line({
    timestamp: at(m),
    type: "response_item",
    payload: {
      type: "message",
      role,
      content: [{ type: role === "user" ? "input_text" : "output_text", text }, ...extra],
    },
  });

const llm = scriptedLlm((req) => {
  const system = String(req.messages[0]?.content);
  if (system.startsWith("You read a stretch")) return say("Role: marketing lead. Recurring tasks: Reels scripts.");
  if (system.startsWith("You merge"))
    return say("## Role\nMarketing lead\n## Recurring tasks\nReels scripts, 9:16, hook first.");
  return say("ok");
});

let env: Awaited<ReturnType<typeof startCore>>;
let acme = "";
let rollout = "";

before(async () => {
  env = await startCore({ llm, aux: true });
  acme = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "apx-import-")));
  fs.mkdirSync(path.join(acme, "reel"));
  fs.writeFileSync(path.join(acme, "reel", "clip.mp4"), Buffer.from("not really a video"));
  fs.writeFileSync(path.join(acme, "reel", "look.css"), "body { color: red; }");
  fs.writeFileSync(
    path.join(acme, "reel", "index.html"),
    '<title>Reel takes</title><link rel="stylesheet" href="look.css"><video src="clip.mp4"></video>',
  );
  const codex = path.join(env.home, "codex-home");
  const day = path.join(codex, "sessions", "2026", "09", "01");
  fs.mkdirSync(day, { recursive: true });
  rollout = path.join(day, "rollout-2026-09-01T10-00-00-c-cmo.jsonl");
  // Codex compresses rollouts while its index still names the .jsonl.
  fs.writeFileSync(
    `${rollout}.zst`,
    zlib.zstdCompressSync(
      Buffer.from(
        line({ type: "session_meta", payload: { id: "c-cmo", cwd: acme, originator: "Codex Desktop" } }) +
          say_("user", "# AGENTS.md instructions for the repo", 0) +
          say_(
            "user",
            "# Files mentioned by the user:\n\n## a.png: /tmp/a.png\n\n## My request:\nYou are Acme's CMO: write Reels scripts. Login demo@example.com / hunter22",
            1,
            [{ type: "input_image", image_url: `data:image/png;base64,${PNG}` }],
          ) +
          line({
            timestamp: at(2),
            type: "response_item",
            payload: { type: "custom_tool_call", name: "exec", input: "*** Add File: reel/index.html\n+<video>" },
          }) +
          say_("assistant", "Here is the first script.", 3),
      ),
    ),
  );
  const db = new DatabaseSync(path.join(codex, "state_5.sqlite"));
  db.exec(`
    CREATE TABLE projects (id TEXT, name TEXT, position INTEGER);
    CREATE TABLE project_roots (project_id TEXT, position INTEGER, path TEXT);
    CREATE TABLE threads (id TEXT, rollout_path TEXT, cwd TEXT, title TEXT, name TEXT, updated_at INTEGER,
      archived INTEGER, thread_source TEXT, project_id TEXT, originator TEXT, agent_role TEXT);`);
  db.prepare("INSERT INTO projects VALUES ('p1', 'Acme company', 0)").run();
  db.prepare("INSERT INTO project_roots VALUES ('p1', 0, ?)").run(acme);
  const thread = db.prepare("INSERT INTO threads VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)");
  thread.run("c-cmo", rollout, acme, "You are Acme's CMO", "CMO", 1788000000, 0, "user", "p1", "Codex Desktop", null);
  thread.run("c-sub", rollout, acme, "explore", null, 1788000000, 0, "subagent", "p1", "Codex Desktop", "explorer");
  db.close();
  const claude = path.join(env.home, "claude-home", "projects", "-work-acme");
  fs.mkdirSync(claude, { recursive: true });
  fs.writeFileSync(
    path.join(claude, "s-fix.jsonl"),
    line({ type: "user", cwd: acme, timestamp: at(5), message: { role: "user", content: "Fix the reel page" } }) +
      line({
        type: "assistant",
        timestamp: at(6),
        message: {
          role: "assistant",
          content: [
            { type: "tool_use", id: "t1", name: "Edit", input: { file_path: path.join(acme, "reel", "index.html") } },
            { type: "text", text: "Fixed." },
          ],
        },
      }),
  );
});
after(async () => {
  await env.core.close();
  env.cleanup();
  fs.rmSync(acme, { recursive: true, force: true });
});

test("Codex's projects are listed by their own name, without sub-agents' threads", async () => {
  const { projects } = await env.client.call("sessions.projects", { engine: "codex" });
  assert.equal(projects.length, 1);
  assert.equal(projects[0]?.name, "Acme company");
  assert.equal(projects[0]?.cwd, acme);
  assert.deepEqual(
    projects[0]?.sessions.map((s) => [s.id, s.title]),
    [["c-cmo", "CMO"]],
  );
});

test("importing makes the folder a project and each session a chat with its whole history", async () => {
  const r = await env.client.call("sessions.import", { engine: "codex", cwd: acme });
  assert.equal(r.project.name, "Acme company");
  assert.ok(fs.existsSync(path.join(acme, ".apc", "project.json")));
  assert.deepEqual(r.pages, [path.join("reel", "index.html")]);
  const chat = r.chats[0];
  assert.equal(chat?.created, true);
  const thread = await env.client.call("threads.get", { thread: chat?.thread ?? "" });
  assert.equal(thread.thread.project_id, r.project.id);
  const [owner, answer] = thread.messages;
  assert.deepEqual(owner?.author, { kind: "user" });
  assert.equal(owner?.parts.find((p) => p.type === "text")?.text.startsWith("You are Acme's CMO"), true);
  assert.equal(owner?.parts.filter((p) => p.type === "image").length, 1);
  assert.deepEqual(
    answer?.parts.map((p) => p.type),
    ["tool", "text"],
  );
  const listed = await env.client.call("sessions.projects", { engine: "codex" });
  assert.equal(listed.projects[0]?.project_id, r.project.id);
  assert.equal(listed.projects[0]?.sessions[0]?.thread, chat?.thread);
});

test("importing again brings only what is new", async () => {
  const before = zlib.zstdDecompressSync(fs.readFileSync(`${rollout}.zst`)).toString("utf8");
  fs.writeFileSync(
    `${rollout}.zst`,
    zlib.zstdCompressSync(Buffer.from(before + say_("user", "Now a second one", 7) + say_("assistant", "Done.", 8))),
  );
  const again = await env.client.call("sessions.import", { engine: "codex", cwd: acme });
  assert.equal(again.chats[0]?.created, false);
  assert.equal(again.chats[0]?.added, 2);
  const still = await env.client.call("sessions.import", { engine: "codex", cwd: acme });
  assert.equal(still.chats[0]?.added, 0);
  const t = await env.client.call("threads.get", { thread: again.chats[0]?.thread ?? "" });
  assert.equal(t.messages.length, 4);
});

test("the digest keeps the owner's framing word for word, without their password", async () => {
  const { projects } = await env.client.call("sessions.projects", { engine: "codex" });
  const thread = projects[0]?.sessions[0]?.thread ?? "";
  const d = await env.client.call("sessions.digest", { thread });
  assert.match(d.digest, /## Framing\n\n> You are Acme's CMO: write Reels scripts\./);
  assert.doesNotMatch(d.digest, /hunter22/);
  assert.match(d.digest, /## Recurring tasks/);
  const notes = llm.calls.filter((c) => String(c.messages[0]?.content).startsWith("You read a stretch"));
  assert.doesNotMatch(JSON.stringify(notes), /hunter22/);
  const cached = await env.client.call("sessions.digest", { thread });
  assert.equal(cached.at, d.at);
});

test("an agent of the project takes an imported chat over, earlier answers included", async () => {
  const { projects } = await env.client.call("sessions.projects", { engine: "codex" });
  const project = projects[0]?.project_id ?? "";
  const thread = projects[0]?.sessions[0]?.thread ?? "";
  const cmo = await env.client.call("agents.create", { project_id: project, slug: "cmo", name: "Cleo", role: "CMO" });
  const t = await env.client.call("sessions.adopt", { thread, agent: "cmo" });
  assert.equal(t.agent_ids[0], cmo.id);
  const { messages } = await env.client.call("threads.get", { thread });
  assert.ok(
    messages.filter((m) => m.author.kind === "agent").every((m) => m.author.kind === "agent" && m.author.id === cmo.id),
  );
  const loose = await env.client.call("threads.create", { kind: "loose", agent_id: "roby" });
  await assert.rejects(env.client.call("sessions.adopt", { thread: loose.id, agent: "cmo" }), /not a chat brought/);
});

test("a page a chat wrote becomes a pinned widget that loads its media from the folder", async () => {
  const { projects } = await env.client.call("sessions.projects", { engine: "codex" });
  const project_id = projects[0]?.project_id ?? "";
  const s = await env.client.call("surfaces.import_page", { project_id, path: "reel/index.html" });
  assert.equal(s.title, "Reel takes");
  assert.equal(s.pinned, true);
  const full = await env.client.call("surfaces.get", { surface: s.id });
  assert.match(full.html, /<style>\nbody \{ color: red; \}\n<\/style>/);
  assert.match(full.html, /<video data-apx-src="reel\/clip\.mp4">/);
  await assert.rejects(
    env.client.call("surfaces.import_page", { project_id, path: "../outside.html" }),
    /not in the project/,
  );
});

test("Claude Code sessions group by their folder and land in the same project", async () => {
  const { projects } = await env.client.call("sessions.projects", { engine: "claude" });
  const acmeGroup = projects.find((p) => p.cwd === acme);
  assert.equal(acmeGroup?.sessions[0]?.title, "Fix the reel page");
  const r = await env.client.call("sessions.import", { engine: "claude", cwd: acme });
  const codex = await env.client.call("sessions.projects", { engine: "codex" });
  assert.equal(r.project.id, codex.projects[0]?.project_id);
  assert.deepEqual(r.pages, [path.join("reel", "index.html")]);
});
