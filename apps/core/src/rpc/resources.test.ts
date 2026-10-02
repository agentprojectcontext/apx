import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";
import { say, scriptedLlm, startCore } from "../engine/testkit.ts";
import { skillsFor } from "../skills/skills.ts";

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
  home = fs.mkdtempSync(path.join(os.tmpdir(), "apx2-res-"));
  skill(path.join(home, "skills"), "brief", "Writes a morning brief.");
  env = await startCore({ llm: scriptedLlm(() => say("ok")), home });
  repo = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "apx2-res-repo-")));
  fs.mkdirSync(path.join(repo, ".apc"), { recursive: true });
  fs.writeFileSync(path.join(repo, "AGENTS.md"), "# Acme\n");
  project = (await env.client.call("projects.register", { path: repo })).project.id;
});
after(async () => {
  await env.core.close();
  env.cleanup();
  fs.rmSync(repo, { recursive: true, force: true });
});

test("a global skill turned off in one project is off only there; agents there no longer see it", async () => {
  const before = await env.client.call("skills.list", { project });
  assert.equal(before.skills.find((s) => s.name === "brief")?.on, true);
  assert.equal(before.skills.find((s) => s.name === "brief")?.source, "owner");
  await env.client.call("skills.toggle", { name: "brief", project, on: false });
  const there = await env.client.call("skills.list", { project });
  assert.equal(there.skills.find((s) => s.name === "brief")?.on, false, "listed, but off");
  assert.ok(!skillsFor(env.core.store, home, project).some((s) => s.name === "brief"), "not in that project's catalog");
  assert.ok(skillsFor(env.core.store, home, undefined).some((s) => s.name === "brief"));
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
