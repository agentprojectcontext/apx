import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";
import { ApxClient, ApxError } from "@apx/protocol/client";
import { say, scriptedLlm, startCore } from "../engine/testkit.ts";
import { realpath } from "../paths.ts";
import { removeDir } from "../testkit/platform.ts";
import { scratchRoot } from "../tools/folders.ts";

/** Named pipes are a POSIX file kind; Windows has none to list or refuse. */
const FIFO = process.platform !== "win32";

let env: Awaited<ReturnType<typeof startCore>>;
/** What Finder and the trash were asked to do. */
const desktopCalls: string[] = [];
const desktop = {
  reveal: async (abs: string) => void desktopCalls.push(`reveal ${abs}`),
  open: async (abs: string) => void desktopCalls.push(`open ${abs}`),
  trash: async (abs: string) => void desktopCalls.push(`trash ${abs}`),
};
let repo = "";
let outside = "";
let project = "";

before(async () => {
  env = await startCore({ llm: scriptedLlm(() => say("ok")), desktop });
  repo = realpath(fs.mkdtempSync(path.join(os.tmpdir(), "apx-files-repo-")));
  outside = realpath(fs.mkdtempSync(path.join(os.tmpdir(), "apx-files-out-")));
  fs.mkdirSync(path.join(repo, ".apc"), { recursive: true });
  fs.mkdirSync(path.join(repo, "docs"));
  fs.mkdirSync(path.join(repo, ".git"));
  fs.writeFileSync(path.join(repo, ".git", "config"), "[core]");
  fs.writeFileSync(path.join(repo, "AGENTS.md"), "# Acme\n");
  fs.writeFileSync(path.join(repo, "docs", "plan.md"), "Ship on Friday.\n");
  fs.writeFileSync(path.join(repo, "logo.png"), Buffer.from([0x89, 0x50, 0x4e, 0x47, 0, 0, 1]));
  fs.writeFileSync(path.join(outside, "secret.txt"), "not yours");
  fs.symlinkSync(outside, path.join(repo, "escape"));
  fs.symlinkSync(path.join(repo, "docs"), path.join(repo, "docs-link"));
  fs.symlinkSync(path.join(repo, ".git"), path.join(repo, "gitmeta"));
  if (FIFO) execFileSync("mkfifo", [path.join(repo, "pipe")]);
  project = (await env.client.call("projects.register", { path: repo })).project.id;
});
after(async () => {
  await env.core.close();
  await env.cleanup();
  await removeDir(repo);
  await removeDir(outside);
});

test("a folder lists its folders first; .git and links that leave the folder are left out", async () => {
  const { entries, truncated } = await env.client.call("files.tree", { project });
  assert.equal(truncated, false);
  assert.deepEqual(
    entries.map((e) => `${e.kind}:${e.path}`),
    ["dir:.apc", "dir:docs", "dir:docs-link", "file:AGENTS.md", "file:logo.png"],
  );
  const docs = await env.client.call("files.tree", { project, dir: "docs" });
  assert.deepEqual(docs.entries, [{ name: "plan.md", path: "docs/plan.md", kind: "file", bytes: 16 }]);
});

test("a file's text; a binary file says so", async () => {
  const plan = await env.client.call("files.read", { project, path: "docs/plan.md" });
  assert.equal(plan.text, "Ship on Friday.\n");
  const logo = await env.client.call("files.read", { project, path: "logo.png" });
  assert.equal(logo.binary, true);
  assert.equal(logo.text, undefined);
});

test("nothing outside the folder: .., absolute paths, links out, .git; and only the owner", async () => {
  for (const p of ["../x", "escape/secret.txt", ".git/config", `docs/../../${path.basename(outside)}/secret.txt`])
    await assert.rejects(env.client.call("files.read", { project, path: p }), /outside the folder/, p);
  // An absolute path is read inside the folder, never from the root of the disk.
  await assert.rejects(env.client.call("files.read", { project, path: "/etc/hosts" }), /file \/etc\/hosts not found/);
  await assert.rejects(env.client.call("files.tree", { project, dir: "escape" }), /outside the folder/);
  const agent = new ApxClient({ url: env.core.url, actor: "agent" });
  await assert.rejects(
    agent.call("files.read", { project, path: "AGENTS.md" }),
    (e: unknown) => e instanceof ApxError && /reserved to the owner/.test(e.message),
  );
});

test(".git stays hidden by any name or case; a pipe is not read (and does not hang the core)", async () => {
  const { entries } = await env.client.call("files.tree", { project });
  assert.ok(!entries.some((e) => e.name === "gitmeta" || e.name === "pipe"));
  for (const p of ["gitmeta/config", ".GIT/config", "docs/../.Git/config"])
    await assert.rejects(env.client.call("files.read", { project, path: p }), /outside the folder/, p);
  if (FIFO) await assert.rejects(env.client.call("files.read", { project, path: "pipe" }), /not a file/);
});

test("media: images, video, audio and PDF are previewed as bytes; other files are not", async () => {
  const m = await env.client.call("files.media", { project, path: "logo.png" });
  assert.equal(m.mime, "image/png");
  assert.equal(Buffer.from(m.data, "base64")[1], 0x50);
  await assert.rejects(env.client.call("files.media", { project, path: "docs/plan.md" }), /not an image/);
  await assert.rejects(env.client.call("files.media", { project, path: "escape/secret.txt" }), /outside/);
});

test("Finder, rename and trash stay inside the folder; the trash never takes the folder itself or .git", async () => {
  await env.client.call("files.reveal", { project, path: "docs/plan.md" });
  assert.equal(desktopCalls.at(-1), `reveal ${path.join(repo, "docs", "plan.md")}`);
  await env.client.call("files.open", { project, path: "docs/plan.md" });
  assert.equal(desktopCalls.at(-1), `open ${path.join(repo, "docs", "plan.md")}`);
  await assert.rejects(env.client.call("files.open", { project, path: "logo.png" }), /only \.md/);
  const doc = await env.client.call("media.upload", {
    name: "Plan.md",
    mime: "text/markdown",
    data: Buffer.from("# Plan\n").toString("base64"),
  });
  await env.client.call("documents.open", { media_id: doc.media.id });
  const opened = String(desktopCalls.at(-1)).replace(/^open /, "");
  assert.equal(path.basename(opened), "Plan.md");
  assert.equal(fs.readFileSync(opened, "utf8"), "# Plan\n");
  const sheet = await env.client.call("media.upload", {
    name: "rows.csv",
    mime: "text/csv",
    data: Buffer.from("a,b\n").toString("base64"),
  });
  await assert.rejects(env.client.call("documents.open", { media_id: sheet.media.id }), /not found/);

  fs.writeFileSync(path.join(repo, "draft.txt"), "x");
  const r = await env.client.call("files.rename", { project, path: "draft.txt", name: "final.txt" });
  assert.equal(r.path, "final.txt");
  assert.ok(fs.existsSync(path.join(repo, "final.txt")));
  await assert.rejects(env.client.call("files.rename", { project, path: "final.txt", name: "AGENTS.md" }), /exists/);
  await assert.rejects(env.client.call("files.rename", { project, path: "final.txt", name: "../out.txt" }));
  await assert.rejects(env.client.call("files.rename", { project, path: "final.txt", name: ".git" }), /outside/);

  await env.client.call("files.trash", { project, path: "final.txt" });
  assert.equal(desktopCalls.at(-1), `trash ${path.join(repo, "final.txt")}`);
  const before = desktopCalls.length;
  await assert.rejects(env.client.call("files.trash", { project, path: "/" }), /never moved/);
  await assert.rejects(env.client.call("files.trash", { project, path: ".git" }), /outside/);
  await assert.rejects(env.client.call("files.trash", { project, path: "escape/secret.txt" }), /outside/);
  assert.equal(desktopCalls.length, before, "nothing else reached the trash");
});

test("a chat browses the folder its agent works in: its project's, or else APX's work folder", async () => {
  const inProject = await env.client.call("threads.create", { kind: "loose", agent_id: "roby", project_id: project });
  assert.equal((await env.client.call("files.tree", { thread: inProject.id })).root, repo);
  const bare = await env.client.call("threads.create", { kind: "loose", agent_id: "roby" });
  const work = await env.client.call("files.tree", { thread: bare.id });
  assert.equal(work.root, realpath(path.join(env.home, "work")));
  fs.writeFileSync(path.join(work.root, "notes.md"), "Draft.\n");
  assert.equal((await env.client.call("files.read", { thread: bare.id, path: "notes.md" })).text, "Draft.\n");
  await assert.rejects(env.client.call("files.read", { thread: bare.id, path: "../x" }), /outside the folder/);
  await assert.rejects(env.client.call("files.tree", {}), /a project or a chat/);
});

test("the base project browses APX's work folder, the one its chats work in", async () => {
  const bare = await env.client.call("threads.create", { kind: "loose", agent_id: "roby" });
  const fromChat = await env.client.call("files.tree", { thread: bare.id });
  const fromBase = await env.client.call("files.tree", { base: true });
  assert.equal(fromBase.root, fromChat.root);
  fs.writeFileSync(path.join(fromBase.root, "base.md"), "Shared.\n");
  assert.equal((await env.client.call("files.read", { base: true, path: "base.md" })).text, "Shared.\n");
  await assert.rejects(env.client.call("files.read", { base: true, path: "../x" }), /outside the folder/);
});

test("a chat's temp folder is browsed apart, and what the owner keeps is copied into the chat's folder", async () => {
  const t = await env.client.call("threads.create", { kind: "loose", agent_id: "roby", project_id: project });
  const temp = await env.client.call("files.tree", { thread: t.id, scratch: true });
  assert.equal(temp.root, realpath(path.join(scratchRoot(env.home), t.id)));
  fs.mkdirSync(path.join(temp.root, "out"));
  fs.writeFileSync(path.join(temp.root, "out", "chart.csv"), "a,b\n");
  fs.symlinkSync(outside, path.join(temp.root, "out", "escape"));
  fs.writeFileSync(path.join(temp.root, "AGENTS.md"), "draft\n");
  assert.equal(
    (await env.client.call("files.read", { thread: t.id, scratch: true, path: "out/chart.csv" })).text,
    "a,b\n",
  );
  const kept = await env.client.call("files.keep", { thread: t.id, path: "out" });
  assert.equal(kept.path, "out");
  assert.equal(fs.readFileSync(path.join(repo, "out", "chart.csv"), "utf8"), "a,b\n");
  assert.ok(!fs.existsSync(path.join(repo, "out", "escape")), "a link is left behind");
  // A taken name gets a number; the project's own file stays as it was.
  assert.equal((await env.client.call("files.keep", { thread: t.id, path: "AGENTS.md" })).path, "AGENTS 2.md");
  assert.equal(fs.readFileSync(path.join(repo, "AGENTS.md"), "utf8"), "# Acme\n");
  await assert.rejects(env.client.call("files.keep", { thread: t.id, path: "../x" }), /outside the folder/);
  await assert.rejects(env.client.call("files.tree", { project, scratch: true }), /a chat's/);
  await removeDir(path.join(repo, "out"));
  fs.rmSync(path.join(repo, "AGENTS 2.md"));
});

test("a file downloads whole, any kind; a folder, a pipe or a path outside does not", async () => {
  const plan = await env.client.call("files.download", { project, path: "docs/plan.md" });
  assert.deepEqual(
    { name: plan.name, mime: plan.mime, bytes: plan.bytes, text: Buffer.from(plan.data, "base64").toString() },
    { name: "plan.md", mime: "application/octet-stream", bytes: 16, text: "Ship on Friday.\n" },
  );
  const logo = await env.client.call("files.download", { project, path: "logo.png" });
  assert.equal(logo.mime, "image/png");
  assert.deepEqual(Buffer.from(logo.data, "base64"), fs.readFileSync(path.join(repo, "logo.png")));
  await assert.rejects(env.client.call("files.download", { project, path: "docs" }), /not a file/);
  if (FIFO) await assert.rejects(env.client.call("files.download", { project, path: "pipe" }), /not a file/);
  await assert.rejects(env.client.call("files.download", { project, path: "escape/secret.txt" }), /outside the folder/);
});

test("a text file is edited in place; a change made since it was opened is never overwritten", async () => {
  const read = await env.client.call("files.read", { project, path: "docs/plan.md" });
  assert.ok(read.version);
  const saved = await env.client.call("files.write", {
    project,
    path: "docs/plan.md",
    text: "Ship on Monday.\n",
    version: read.version,
  });
  assert.equal(fs.readFileSync(path.join(repo, "docs", "plan.md"), "utf8"), "Ship on Monday.\n");
  // The old version is stale now: saving with it is refused, and the file keeps the newer text.
  await assert.rejects(
    env.client.call("files.write", { project, path: "docs/plan.md", text: "Stale.\n", version: read.version }),
    /changed since/,
  );
  await env.client.call("files.write", {
    project,
    path: "docs/plan.md",
    text: "Ship on Friday.\n",
    version: saved.version,
  });
  assert.equal(fs.readFileSync(path.join(repo, "docs", "plan.md"), "utf8"), "Ship on Friday.\n");
  await assert.rejects(env.client.call("files.write", { project, path: "../x.txt", text: "no" }), /outside the folder/);
  await assert.rejects(env.client.call("files.write", { project, path: "nope.md", text: "no" }), /not found|nope/);
  await assert.rejects(env.client.call("files.write", { project, path: "docs", text: "no" }), /not a file/);
});
