import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";
import { ApxClient } from "@apx/protocol/client";
import { say, scriptedLlm, startCore } from "../engine/testkit.ts";
import { realpath } from "../paths.ts";
import { skillsFor } from "../skills/skills.ts";
import { removeDir } from "../testkit/platform.ts";

const SERVER = path.join(import.meta.dirname, "..", "mcp", "fake-server.test-support.mjs");
let env: Awaited<ReturnType<typeof startCore>>;
let home = "";
let repo = "";
let project = "";

const skill = (dir: string, name: string, description: string) => {
  fs.mkdirSync(path.join(dir, name), { recursive: true });
  fs.writeFileSync(path.join(dir, name, "SKILL.md"), `---\nname: ${name}\ndescription: ${description}\n---\n\nHow.\n`);
};

before(async () => {
  home = fs.mkdtempSync(path.join(os.tmpdir(), "apx-res-"));
  skill(path.join(home, "skills"), "brief", "Writes a morning brief.");
  env = await startCore({ llm: scriptedLlm(() => say("ok")), home });
  repo = realpath(fs.mkdtempSync(path.join(os.tmpdir(), "apx-res-repo-")));
  fs.mkdirSync(path.join(repo, ".apc"), { recursive: true });
  fs.writeFileSync(path.join(repo, "AGENTS.md"), "# Acme\n");
  project = (await env.client.call("projects.register", { path: repo })).project.id;
});
after(async () => {
  await env.core.close();
  await env.cleanup();
  await removeDir(repo);
});

test("a global skill turned off in one project is off only there; agents there no longer see it", async () => {
  const before = await env.client.call("skills.list", { project });
  assert.equal(before.skills.find((s) => s.name === "brief")?.on, true);
  assert.equal(before.skills.find((s) => s.name === "brief")?.source, "owner");
  await env.client.call("skills.toggle", { name: "brief", project, on: false });
  const there = await env.client.call("skills.list", { project });
  assert.equal(there.skills.find((s) => s.name === "brief")?.on, false, "listed, but off");
  assert.ok(
    !skillsFor(env.core.store, { home }, project).some((s) => s.name === "brief"),
    "not in that project's catalog",
  );
  assert.ok(skillsFor(env.core.store, { home }, undefined).some((s) => s.name === "brief"));
  const elsewhere = await env.client.call("skills.list", {});
  const g = elsewhere.skills.find((s) => s.name === "brief");
  assert.equal(g?.on, true, "still on everywhere else");
  assert.deepEqual(g?.off_in, [project]);
  await env.client.call("skills.toggle", { name: "brief", project, on: true });
});

test("editing a global skill from a project as a copy leaves the original untouched", async () => {
  const got = await env.client.call("skills.get", { name: "brief", project });
  assert.match(got.content, /morning brief/);
  assert.equal(got.skill.editable, true);
  const saved = await env.client.call("skills.save", {
    name: "brief",
    target: "project",
    project,
    content: "---\nname: brief\ndescription: Acme's own brief.\n---\n\nShorter.\n",
  });
  assert.equal(saved.skill.scope, "project", "the project's copy takes its place there");
  assert.match(fs.readFileSync(path.join(repo, ".apc", "skills", "brief", "SKILL.md"), "utf8"), /Acme's own/);
  assert.match(fs.readFileSync(path.join(home, "skills", "brief", "SKILL.md"), "utf8"), /morning brief/);
  const global = (await env.client.call("skills.list", {})).skills.find((s) => s.name === "brief");
  assert.equal(global?.description, "Writes a morning brief.");
});

test("a project skill is never written through a symlink", async () => {
  fs.symlinkSync(os.tmpdir(), path.join(repo, ".apc", "skills", "linked"));
  await assert.rejects(
    env.client.call("skills.save", { name: "linked", target: "project", project, content: "x" }),
    /symlink/,
  );
});

test("variables: a hint only for long values, and where each one is used", async () => {
  await env.client.call("secrets.set", { name: "gh", value: "ghp_0123456789abcd" });
  await env.client.call("secrets.set", { name: "pin", value: "1234" });
  await env.client.call("mcp.set", {
    name: "github",
    server: { command: process.execPath, args: [SERVER], env: { TOKEN: "secret://gh" } },
  });
  const { secrets } = await env.client.call("secrets.list", {});
  const gh = secrets.find((s) => s.name === "gh");
  assert.equal(gh?.hint, "abcd");
  assert.deepEqual(gh?.used_in, ["mcp:github"]);
  assert.equal(secrets.find((s) => s.name === "pin")?.hint, undefined, "a short value gives no hint");
  assert.ok(!JSON.stringify(secrets).includes("ghp_0123"), "values never leave the core");
});

test("mcp: a global server off in one project, a test run, and no test before a project server is approved", async () => {
  const listed = await env.client.call("mcp.list", { project });
  const gh = listed.servers.find((s) => s.name === "github");
  assert.deepEqual(gh?.vars, [{ name: "gh", set: true }]);
  const off = await env.client.call("mcp.toggle", { project, server: "github", on: false });
  assert.equal(off.servers.find((s) => s.name === "github")?.off_here, true);
  const r = await env.client.call("mcp.test", { scope: "global", server: "github" });
  assert.equal(r.ok, true, r.error);
  assert.ok(r.tools.length > 0);

  fs.writeFileSync(
    path.join(repo, ".apc", "mcps.json"),
    JSON.stringify({ mcpServers: { local: { command: process.execPath, args: [SERVER] } } }),
  );
  const refused = await env.client.call("mcp.test", { scope: "project", server: "local", project });
  assert.equal(refused.ok, false);
  assert.match(refused.error ?? "", /approve/);
});

test("a skill whose folder and name differ is edited in its own folder", async () => {
  fs.mkdirSync(path.join(home, "skills", "foo"), { recursive: true });
  fs.writeFileSync(path.join(home, "skills", "foo", "SKILL.md"), "---\nname: bar\ndescription: Old.\n---\n\nx\n");
  const r = await env.client.call("skills.save", {
    name: "bar",
    target: "global",
    content: "---\nname: baz\ndescription: Renamed.\n---\n\ny\n",
  });
  assert.equal(r.skill.name, "baz", "found again after its name changed");
  assert.match(fs.readFileSync(path.join(home, "skills", "foo", "SKILL.md"), "utf8"), /Renamed/);
  assert.ok(!fs.existsSync(path.join(home, "skills", "bar")), "no stray folder named after the frontmatter");
});

test("a planted temp-file symlink cannot redirect a skill write", async () => {
  const dir = path.join(repo, ".apc", "skills", "safe");
  fs.mkdirSync(dir, { recursive: true });
  const outside = path.join(os.tmpdir(), `apx-outside-${process.pid}.txt`);
  fs.writeFileSync(outside, "untouched");
  for (let i = 0; i < 5; i++) fs.symlinkSync(outside, path.join(dir, `SKILL.md.tmp-${process.pid + i}`));
  await env.client.call("skills.save", {
    name: "safe",
    target: "project",
    project,
    content: "---\nname: safe\ndescription: s.\n---\n",
  });
  assert.equal(fs.readFileSync(outside, "utf8"), "untouched");
  assert.ok(!fs.lstatSync(path.join(dir, "SKILL.md")).isSymbolicLink());
  fs.rmSync(outside, { force: true });
});

test("variables may use upper case, like the names MCP servers reference", async () => {
  await env.client.call("secrets.set", { name: "GH_TOKEN", value: "ghp_abcdefghijklmnop" });
  assert.ok((await env.client.call("secrets.list", {})).secrets.some((s) => s.name === "GH_TOKEN"));
});

test("variables: a project's own value wins for the owner's servers there, and is listed with its project", async () => {
  await env.client.call("mcp.set", {
    name: "notes",
    server: { command: process.execPath, args: [SERVER], env: { NOTES_TOKEN: "secret://NOTES_TOKEN" } },
  });
  const vars = async (p?: string) =>
    (await env.client.call("mcp.list", p ? { project: p } : {})).servers.find((x) => x.name === "notes")?.vars;
  assert.deepEqual(await vars(project), [{ name: "NOTES_TOKEN", set: false }]);
  await env.client.call("secrets.set", { name: "NOTES_TOKEN", value: "acme-notes-0123456789", project });
  assert.deepEqual(await vars(project), [{ name: "NOTES_TOKEN", set: true }], "set in this project");
  assert.deepEqual(await vars(), [{ name: "NOTES_TOKEN", set: false }], "not globally");
  const mine = (await env.client.call("secrets.list", {})).secrets.find((x) => x.name === "NOTES_TOKEN");
  assert.equal(mine?.project_id, project);
  assert.equal(mine?.hint, "6789");
  assert.deepEqual(mine?.used_in, ["mcp:notes"]);
  await assert.rejects(env.client.call("secrets.set", { name: "X", value: "y", project: "p_nope" }), /not found/);
});

test("a variable never goes in a server's args, where the process list shows it", async () => {
  await assert.rejects(
    env.client.call("mcp.set", { name: "leaky", server: { command: "npx", args: ["--token", "secret://GH_TOKEN"] } }),
    /process list: put it in env/,
  );
});

test("a project can take none of the owner's global skills or servers; its own still count", async () => {
  skill(path.join(repo, ".apc", "skills"), "acme-only", "Acme's own way.");
  skill(path.join(home, "skills"), "digest", "A weekly digest.");
  assert.deepEqual(await env.client.call("resources.inheritance", { project }), { skills: true, mcp: true });
  await env.client.call("mcp.set", { name: "inherit-probe", server: { command: process.execPath, args: [SERVER] } });

  const r = await env.client.call("resources.inherit", { project, kind: "skills", on: false });
  assert.deepEqual(r, { skills: false, mcp: true });
  const there = (await env.client.call("skills.list", { project })).skills;
  assert.equal(there.find((s) => s.name === "digest")?.on, false, "global: off here");
  assert.equal(there.find((s) => s.name === "acme-only")?.on, true, "its own: on");
  const catalog = skillsFor(env.core.store, { home }, project).map((s) => s.name);
  assert.ok(catalog.includes("acme-only") && !catalog.includes("digest"));
  assert.ok(
    skillsFor(env.core.store, { home }, undefined).some((s) => s.name === "digest"),
    "still on elsewhere",
  );

  await env.client.call("resources.inherit", { project, kind: "mcp", on: false });
  const servers = (await env.client.call("mcp.list", { project })).servers;
  assert.equal(servers.find((s) => s.name === "inherit-probe")?.off_here, true, "global server off here");

  assert.deepEqual(await env.client.call("resources.inherit", { project, kind: "skills", on: true }), {
    skills: true,
    mcp: false,
  });
  await env.client.call("resources.inherit", { project, kind: "mcp", on: true });
  await env.client.call("mcp.set", { name: "inherit-probe", server: null });
});

test("the owner can see a variable's value; an agent client cannot", async () => {
  await env.client.call("secrets.set", { name: "NORTHWIND_TOKEN", value: "nw-123456" });
  assert.deepEqual(await env.client.call("secrets.reveal", { name: "NORTHWIND_TOKEN" }), { value: "nw-123456" });
  const agent = new ApxClient({ url: env.core.url, actor: "agent" });
  await assert.rejects(agent.call("secrets.reveal", { name: "NORTHWIND_TOKEN" }));
  await assert.rejects(env.client.call("secrets.reveal", { name: "NOT_THERE" }));
});

test("other agent apps get APX's skills: only the installed ones, and a dry run writes nothing", async () => {
  const claude = path.join(home, "claude-home");
  fs.mkdirSync(claude, { recursive: true });
  const dry = await env.client.call("skills.runtimes", { dry_run: true });
  assert.ok(dry.steps.every((s) => s.runtime === "Claude Code" && s.action === "create"));
  assert.ok(dry.missing.some((m) => m.runtime === "Codex"));
  assert.ok(!fs.existsSync(path.join(claude, "skills", "apx")));
  await env.client.call("skills.runtimes", {});
  assert.match(fs.readFileSync(path.join(claude, "skills", "apx", "SKILL.md"), "utf8"), /^---\nname: apx\n/);
  const again = await env.client.call("skills.runtimes", {});
  assert.ok(again.steps.every((s) => s.action === "unchanged"));
});
