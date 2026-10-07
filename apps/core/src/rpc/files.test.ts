import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";
import { ApxClient, ApxError } from "@apx/protocol/client";
import { say, scriptedLlm, startCore } from "../engine/testkit.ts";

let env: Awaited<ReturnType<typeof startCore>>;
/** What Finder and the trash were asked to do. */
const desktopCalls: string[] = [];
const desktop = {
  reveal: async (abs: string) => void desktopCalls.push(`reveal ${abs}`),
  trash: async (abs: string) => void desktopCalls.push(`trash ${abs}`),
};
let repo = "";
let outside = "";
let project = "";

before(async () => {
  env = await startCore({ llm: scriptedLlm(() => say("ok")), desktop });
  repo = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "apx-files-repo-")));
  outside = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "apx-files-out-")));
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
  execFileSync("mkfifo", [path.join(repo, "pipe")]);
  project = (await env.client.call("projects.register", { path: repo })).project.id;
});
after(async () => {
  await env.core.close();
  env.cleanup();
  fs.rmSync(repo, { recursive: true, force: true });
  fs.rmSync(outside, { recursive: true, force: true });
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
  await assert.rejects(env.client.call("files.read", { project, path: "pipe" }), /not a file/);
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
  assert.equal(work.root, fs.realpathSync(path.join(env.home, "work")));
  fs.writeFileSync(path.join(work.root, "notes.md"), "Draft.\n");
  assert.equal((await env.client.call("files.read", { thread: bare.id, path: "notes.md" })).text, "Draft.\n");
  await assert.rejects(env.client.call("files.read", { thread: bare.id, path: "../x" }), /outside the folder/);
  await assert.rejects(env.client.call("files.tree", {}), /a project or a chat/);
});
