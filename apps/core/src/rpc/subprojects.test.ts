import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { after, before, test } from "node:test";
import { BASE_PROJECT_ID } from "@apx/protocol";
import { lineage } from "../domain/projects.ts";
import { callTool, say, scriptedLlm, startCore } from "../engine/testkit.ts";
import { isInside, samePath } from "../paths.ts";
import { createSecrets } from "../secrets.ts";
import { type TempDir, tempDir } from "../testkit/platform.ts";
import { withProjectAutonomy } from "../tools/policy.ts";

// "read the note" reads note.md by a relative path: it resolves in the folder the turn works in.
const llm = scriptedLlm((_req, { said, afterTool }) =>
  said.includes("read the note") && !afterTool ? callTool("c1", "file_read", { path: "note.md" }) : say("ok"),
);
let env: Awaited<ReturnType<typeof startCore>>;
let work: TempDir;
let parent = "";
let parentDir = "";

/** A project folder with agents (slug → name), an AGENTS.md line and its memory notes. */
function makeProject(root: string, name: string, agents: Record<string, string>, memo: string) {
  fs.mkdirSync(path.join(root, ".apc", "agents"), { recursive: true });
  fs.writeFileSync(path.join(root, "AGENTS.md"), `# ${name}\n${name} rules.\n`);
  fs.writeFileSync(path.join(root, ".apc", "memory.md"), `${memo}\n`);
  for (const [slug, agent] of Object.entries(agents))
    fs.writeFileSync(
      path.join(root, ".apc", "agents", `${slug}.md`),
      `---\nname: ${agent}\nrole: Helper\n---\n\nHelp.\n`,
    );
}

const skill = (root: string, name: string, description: string) => {
  const dir = path.join(root, ".apc", "skills", name);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "SKILL.md"), `---\nname: ${name}\ndescription: ${description}\n---\n\nKnow-how.\n`);
};

const agentId = async (name: string) => {
  const { agents } = await env.client.call("agents.list", {});
  const a = agents.find((x) => x.name === name);
  assert.ok(a, `agent ${name}`);
  return a.id;
};

before(async () => {
  env = await startCore({ llm });
  work = tempDir("apx-subprojects-");
  parentDir = path.join(work.path, "northwind");
  makeProject(parentDir, "Northwind", { lead: "Lena" }, "PARENT-MEMO");
  parent = (await env.client.call("projects.register", { path: parentDir })).project.id;
});
after(async () => {
  await env.core.close();
  await env.cleanup();
  await work.remove();
});

test("a subproject goes inside its parent's folder; one of the base project's in APX's home", async () => {
  const sub = (await env.client.call("projects.create", { name: "Acme Site", parent })).project;
  assert.equal(sub.parent, parent);
  assert.ok(sub.path && samePath(path.dirname(sub.path), parentDir), sub.path);
  assert.equal(path.basename(sub.path), "acme-site");

  const based = (await env.client.call("projects.create", { name: "Garden", parent: BASE_PROJECT_ID })).project;
  assert.equal(based.parent, BASE_PROJECT_ID);
  assert.ok(based.path && isInside(path.join(env.home, "projects"), based.path), based.path);

  // A folder named by the owner is used as it is.
  const named = path.join(work.path, "elsewhere");
  const there = (await env.client.call("projects.create", { name: "Elsewhere", path: named, parent })).project;
  assert.ok(there.path && samePath(there.path, named));
  const listed = (await env.client.call("projects.list", {})).projects;
  assert.equal(listed.find((p) => p.id === there.id)?.parent, parent);
});

test("a subproject's team is its own agents and its parent's, those marked as inherited", async () => {
  const childDir = path.join(parentDir, "shop");
  makeProject(childDir, "Shop", { clerk: "Cleo" }, "CHILD-MEMO");
  const child = (await env.client.call("projects.create", { path: childDir, parent })).project.id;
  const lena = await agentId("Lena");
  const cleo = await agentId("Cleo");
  const team = (await env.client.call("agents.list", { project_id: child })).agents;
  assert.deepEqual(
    team.map((a) => [a.id, a.inherited_from]),
    [
      [cleo, undefined],
      [lena, parent],
    ],
  );
  // The parent's own listing has only its agents; the whole directory is unchanged.
  const own = (await env.client.call("agents.list", { project_id: parent })).agents;
  assert.deepEqual(
    own.map((a) => a.id),
    [lena],
  );
  assert.ok((await env.client.call("agents.list", {})).agents.every((a) => a.inherited_from === undefined));

  // The base project's subprojects take its global agents.
  const based = (await env.client.call("projects.create", { name: "Orchard", parent: BASE_PROJECT_ID })).project.id;
  const globals = (await env.client.call("agents.list", { project_id: based })).agents;
  assert.ok(globals.length > 0);
  assert.ok(globals.every((a) => !a.project_id && a.inherited_from === BASE_PROJECT_ID));

  // A subproject that sets no autonomy goes as its parent does; its own wins once set.
  const record = env.core.store.agents.get(cleo);
  assert.ok(record);
  await env.client.call("projects.update", { project: parent, autonomy: "manual" });
  assert.equal(withProjectAutonomy(env.core.store, record).autonomy, "manual");
  await env.client.call("projects.update", { project: child, autonomy: "plan" });
  assert.equal(withProjectAutonomy(env.core.store, record).autonomy, "plan");
  await env.client.call("projects.update", { project: parent, autonomy: null });

  // A parent's agent takes work in the subproject; a child's agent does not work upward in its parent.
  const task = await env.client.call("tasks.create", {
    title: "Price list",
    project: child,
    assignee: lena,
    propose: true,
  });
  assert.equal(task.assignee, lena);
  await assert.rejects(
    env.client.call("tasks.create", { title: "Upward", project: parent, assignee: cleo, propose: true }),
    /works in another project/,
  );
});

test("a parent's agent in a subproject's chat works there, with the subproject's files and memory only", async () => {
  const childDir = path.join(parentDir, "studio");
  makeProject(childDir, "Studio", {}, "CHILD-MEMO");
  const child = (await env.client.call("projects.create", { path: childDir, parent })).project.id;
  const lena = await agentId("Lena");
  fs.writeFileSync(path.join(parentDir, "note.md"), "PARENT-NOTE\n");
  fs.writeFileSync(path.join(childDir, "note.md"), "CHILD-NOTE\n");
  const t = await env.client.call("threads.create", { kind: "loose", agent_id: lena, project_id: child });
  assert.equal(t.project_id, child);
  await env.client.call("threads.send", { thread: t.id, text: "read the note" });
  await env.settle(t.id);
  const last = llm.calls.at(-1)?.messages ?? [];
  const read = last.filter((m) => m.role === "tool").map((m) => String(m.content));
  assert.ok(
    read.some((r) => r.includes("CHILD-NOTE")),
    read.join("\n"),
  );
  assert.ok(!read.some((r) => r.includes("PARENT-NOTE")));
  const prompt = String(last[0]?.content);
  assert.match(prompt, /## Project: studio/);
  assert.match(prompt, /Studio rules\./);
  assert.match(prompt, /CHILD-MEMO/);
  assert.doesNotMatch(prompt, /PARENT-MEMO/);
  assert.doesNotMatch(prompt, /Northwind rules\./);
});

test("a subproject takes its parent's skills and MCP servers, its own of the same name first", async () => {
  const childDir = path.join(parentDir, "lab");
  makeProject(childDir, "Lab", {}, "");
  skill(parentDir, "pricing", "Parent pricing");
  skill(parentDir, "shared", "Parent version");
  skill(childDir, "shared", "Own version");
  fs.writeFileSync(
    path.join(parentDir, ".apc", "mcps.json"),
    JSON.stringify({ mcpServers: { notes: { command: process.execPath, args: ["--version"] } } }),
  );
  const child = (await env.client.call("projects.create", { path: childDir, parent })).project.id;
  const skills = (await env.client.call("skills.list", { project: child })).skills;
  const pricing = skills.find((s) => s.name === "pricing");
  const shared = skills.find((s) => s.name === "shared");
  assert.equal(pricing?.description, "Parent pricing");
  assert.equal(shared?.description, "Own version");
  const servers = (await env.client.call("mcp.list", { project: child })).servers;
  assert.deepEqual(
    servers.filter((s) => s.scope === "project").map((s) => [s.name, s.project_id]),
    [["notes", parent]],
  );

  // Detached, it takes none of them, nor its parent's agents.
  const r = await env.client.call("projects.update", { project: child, parent: null });
  assert.equal(r.project.parent, undefined);
  const after = (await env.client.call("skills.list", { project: child })).skills;
  assert.equal(
    after.find((s) => s.name === "pricing"),
    undefined,
  );
  assert.deepEqual(
    (await env.client.call("mcp.list", { project: child })).servers.filter((s) => s.scope === "project"),
    [],
  );
  assert.deepEqual((await env.client.call("agents.list", { project_id: child })).agents, []);
  await assert.rejects(
    env.client.call("tasks.create", { title: "Gone", project: child, assignee: await agentId("Lena"), propose: true }),
    /works in another project/,
  );
});

test("a subproject lists its parent's apps under its own when asked for what it inherits", async () => {
  const child = (await env.client.call("projects.create", { name: "Kiosk", parent })).project.id;
  const app = (name: string, project: string, title: string) =>
    env.client.call("surfaces.show", { name, title, html: "<p>x</p>", project, app: true });
  await app("prices", parent, "Parent prices");
  await app("board", parent, "Parent board");
  await app("board", child, "Own board");
  const listed = (await env.client.call("surfaces.list", { project_id: child, inherited: true })).surfaces;
  assert.deepEqual(listed.map((x) => [x.name, x.title, x.project_id]).sort(), [
    ["board", "Own board", child],
    ["prices", "Parent prices", parent],
  ]);
  // Without asking, a project's own only, as before.
  const own = (await env.client.call("surfaces.list", { project_id: child })).surfaces;
  assert.deepEqual(
    own.map((x) => x.name),
    ["board"],
  );
});

test("a subproject's variables fall back to its parent's own, then the global ones", async () => {
  const childDir = path.join(parentDir, "vars");
  makeProject(childDir, "Vars", {}, "");
  const child = (await env.client.call("projects.create", { path: childDir, parent })).project.id;
  await using dir = tempDir("apx-subproject-secrets-");
  const secrets = createSecrets(dir.path, "file");
  secrets.set("API_KEY", "global");
  secrets.set(`~${parent}/API_KEY`, "parent");
  secrets.set(`~${parent}/TOKEN`, "parent-token");
  secrets.set(`~${child}/TOKEN`, "own-token");
  const chain = lineage(env.core.store.projects, child);
  assert.deepEqual(chain, [child, parent]);
  assert.equal(secrets.resolveIn("secret://API_KEY", chain), "parent");
  assert.equal(secrets.resolveIn("secret://TOKEN", chain), "own-token");
  assert.equal(secrets.resolveIn("secret://API_KEY", lineage(env.core.store.projects, parent)), "parent");
  await env.client.call("projects.update", { project: child, parent: null });
  assert.equal(secrets.resolveIn("secret://API_KEY", lineage(env.core.store.projects, child)), "global");
});

test("only one level, never itself, never a project that has subprojects", async () => {
  const sub = (await env.client.call("projects.create", { name: "Level one", parent })).project.id;
  await assert.rejects(env.client.call("projects.create", { name: "Level two", parent: sub }), /is a subproject/);
  await assert.rejects(env.client.call("projects.update", { project: parent, parent }), /own subproject/);
  const other = (await env.client.call("projects.create", { name: "Contoso" })).project.id;
  await assert.rejects(
    env.client.call("projects.update", { project: parent, parent: other }),
    /with subprojects cannot become/,
  );
  await assert.rejects(env.client.call("projects.update", { project: other, parent: "p_missing" }), /no project/);
  // A project of its own moves under one, and back.
  assert.equal((await env.client.call("projects.update", { project: other, parent })).project.parent, parent);
  assert.equal((await env.client.call("projects.update", { project: other, parent: null })).project.parent, undefined);
});

test("removing a parent leaves its subprojects as projects of their own", async () => {
  const dir = path.join(work.path, "contoso-group");
  makeProject(dir, "Contoso Group", { boss: "Bo" }, "");
  const group = (await env.client.call("projects.register", { path: dir })).project.id;
  const kid = (await env.client.call("projects.create", { name: "Contoso Kids", parent: group })).project.id;
  await env.client.call("projects.unregister", { project: group });
  const listed = (await env.client.call("projects.list", {})).projects;
  const now = listed.find((p) => p.id === kid);
  assert.ok(now);
  assert.equal(now.parent, undefined);
  assert.equal(
    listed.find((p) => p.id === group),
    undefined,
  );
  assert.deepEqual((await env.client.call("agents.list", { project_id: kid })).agents, []);
});
