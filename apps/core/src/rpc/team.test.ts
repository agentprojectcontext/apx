import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";
import { AGENT_NAMES } from "@apx/protocol";
import { say, scriptedLlm, startCore } from "../engine/testkit.ts";
import { realpath } from "../paths.ts";
import { removeDir } from "../testkit/platform.ts";

let env: Awaited<ReturnType<typeof startCore>>;
let home = "";
let repo = "";
let project = "";

before(async () => {
  home = fs.mkdtempSync(path.join(os.tmpdir(), "apx-team-"));
  // The owner's v1 vault (inside the test home): one loose agent and a link that must never be followed.
  const vault = path.join(home, "v1", "agents");
  fs.mkdirSync(vault, { recursive: true });
  fs.writeFileSync(
    path.join(vault, "scout.md"),
    "---\nname: Scout\nrole: Research\narea: research\n---\n\nFind things.\n",
  );
  fs.symlinkSync("/etc", path.join(vault, "linked"));
  env = await startCore({ llm: scriptedLlm(() => say("ok")), home });
  repo = realpath(fs.mkdtempSync(path.join(os.tmpdir(), "apx-team-repo-")));
  fs.mkdirSync(path.join(repo, ".apc", "agents"), { recursive: true });
  fs.writeFileSync(path.join(repo, ".apc", "agents", "boss.md"), "---\nname: Boss\nrole: Orchestrator\n---\n\nLead.\n");
  project = (await env.client.call("projects.register", { path: repo })).project.id;
});
after(async () => {
  await env.core.close();
  await env.cleanup();
  await removeDir(repo);
});

test("templates: APX's teams with their lead, and single agents from APX and the v1 vault", async () => {
  const { teams, singles } = await env.client.call("agents.templates", {});
  const product = teams.find((t) => t.id === "apx:product-team");
  assert.ok(product, "the product team ships with APX");
  assert.equal(product.name, "Product team");
  assert.deepEqual(
    product.members.filter((m) => m.lead).map((m) => m.slug),
    ["orchestrator"],
  );
  assert.equal(product.members.find((m) => m.slug === "security")?.parent, "qa-engineer");
  assert.ok(
    singles.some((s) => s.id === "v1:-:scout" && s.area === "research"),
    "the v1 vault is read",
  );
  assert.ok(
    singles.some((s) => s.slug === "cfo"),
    "team members are offered on their own",
  );
  assert.ok(!singles.some((s) => s.id.includes("linked")), "a symlinked folder is not followed");
});

test("install: the team keeps its shape, its lead hangs under the orchestrator, existing slugs are skipped", async () => {
  const before = fs.readFileSync(path.join(repo, ".apc", "agents", "boss.md"), "utf8");
  const r = await env.client.call("agents.install", {
    project_id: project,
    templates: ["apx:product-team:orchestrator", "apx:product-team:qa-engineer", "apx:product-team:security"],
    hang_under: "boss",
  });
  assert.deepEqual(r.skipped, []);
  const bySlug = Object.fromEntries(r.installed.map((a) => [a.slug, a]));
  assert.equal(bySlug.orchestrator?.parent, "boss", "the lead hangs under the project's orchestrator");
  assert.equal(bySlug["qa-engineer"]?.parent, "orchestrator", "its team parent came along");
  assert.equal(bySlug.security?.parent, "qa-engineer", "the team's own shape is kept");
  assert.equal(bySlug.security?.area, "quality", "area comes from the file");
  assert.equal(bySlug.orchestrator?.role, "Lead Orchestrator", "the template's job becomes the role");
  const names = r.installed.map((a) => a.name);
  assert.ok(
    names.every((n) => (AGENT_NAMES as readonly string[]).includes(n)),
    `each member gets a person's name: ${names.join(", ")}`,
  );
  assert.equal(new Set(names).size, names.length, "no two members share a name");
  const file = fs.readFileSync(path.join(repo, ".apc", "agents", "security.md"), "utf8");
  assert.match(file, new RegExp(`^name: ${bySlug.security?.name}$`, "m"), "the name is in the agent's file");
  assert.match(file, /area: quality/, "the template's other fields are kept");
  assert.equal(fs.readFileSync(path.join(repo, ".apc", "agents", "boss.md"), "utf8"), before, "nothing else changes");

  const again = await env.client.call("agents.install", {
    project_id: project,
    templates: ["apx:product-team:security"],
  });
  assert.equal(again.installed.length, 0);
  assert.match(again.skipped[0]?.reason ?? "", /already has security/);
});

test("install refuses a parent that is not in the project", async () => {
  await assert.rejects(
    env.client.call("agents.install", { project_id: project, templates: ["v1:-:scout"], hang_under: "nobody" }),
    /not an agent of this project/,
  );
});

test("moving an agent: another agent of the project, never one of its own reports", async () => {
  const { agents } = await env.client.call("agents.list", {});
  const of = (slug: string) => agents.find((a) => a.project_id === project && a.slug === slug)?.id ?? "";
  await assert.rejects(env.client.call("agents.update", { agent: of("boss"), parent: "security" }), /make a loop/);
  await assert.rejects(env.client.call("agents.update", { agent: of("boss"), parent: "boss" }), /not another agent/);
  const moved = await env.client.call("agents.update", { agent: of("security"), parent: "boss" });
  assert.equal(moved.parent, "boss");
  const root = await env.client.call("agents.update", { agent: of("security"), parent: "" });
  assert.equal(root.parent, undefined, "an empty parent makes it a root");
  const byId = await env.client.call("agents.update", { agent: of("security"), parent: of("boss") });
  assert.equal(byId.parent, "boss", "a full id names the same agent and the file keeps its slug");
  await assert.rejects(env.client.call("agents.update", { agent: of("boss"), parent: of("security") }), /make a loop/);
  await assert.rejects(env.client.call("agents.update", { agent: of("boss"), parent: of("boss") }), /not another/);
});

test("global agents report to another global agent or to the super-agent, who reports to nobody", async () => {
  const lead = await env.client.call("agents.create", { slug: "northwind-lead", name: "Lead" });
  const analyst = await env.client.call("agents.create", { slug: "northwind-analyst", name: "Analyst" });
  const moved = await env.client.call("agents.update", { agent: analyst.id, parent: lead.id });
  assert.equal(moved.parent, lead.id);
  assert.equal((await env.client.call("agents.get", { agent: analyst.id })).agent.parent, lead.id, "kept");
  await assert.rejects(env.client.call("agents.update", { agent: lead.id, parent: analyst.id }), /loop/);
  await assert.rejects(env.client.call("agents.update", { agent: "roby", parent: lead.id }), /reports to nobody/);
  await assert.rejects(env.client.call("agents.update", { agent: analyst.id, parent: "boss" }), /not another agent/);
  assert.equal((await env.client.call("agents.update", { agent: analyst.id, parent: "" })).parent, undefined);
});

test("the owner sets an agent's autonomy: kept for a global agent, written to a project agent's file", async () => {
  assert.equal((await env.client.call("agents.update", { agent: "roby", autonomy: "total" })).autonomy, "total");
  assert.equal((await env.client.call("agents.get", { agent: "roby" })).agent.autonomy, "total");
  const { agents } = await env.client.call("agents.list", {});
  const boss = agents.find((a) => a.project_id === project && a.slug === "boss");
  assert.ok(boss);
  assert.equal((await env.client.call("agents.update", { agent: boss.id, autonomy: "manual" })).autonomy, "manual");
  assert.match(fs.readFileSync(path.join(repo, ".apc", "agents", "boss.md"), "utf8"), /^autonomy: manual$/m);
});

test("install: a parent that is skipped never adopts a member; the member hangs under hang_under", async () => {
  // The project's own, unrelated "pm".
  fs.writeFileSync(path.join(repo, ".apc", "agents", "pm.md"), "---\nname: Someone else\n---\n\nNot the team's.\n");
  await env.client.call("projects.sync", { project });
  const r = await env.client.call("agents.install", {
    project_id: project,
    templates: ["apx:product-team:pm", "apx:product-team:designer"],
    hang_under: "boss",
  });
  assert.match(r.skipped[0]?.reason ?? "", /already has pm/);
  assert.equal(r.installed.find((a) => a.slug === "designer")?.parent, "boss");
});

test("an agent's prompt, area and description are read and edited; its activity lists its runs", async () => {
  await env.client.call("agents.update", { agent: "scout", description: "Finds sources", area: "research" });
  const local = await env.client.call("agents.get", { agent: "scout" });
  assert.equal(local.agent.description, "Finds sources", "a global agent keeps its description");
  assert.equal(local.agent.area, "research");
  await env.client.call("agents.update", { agent: "scout", prompt: "Search carefully." });
  assert.equal((await env.client.call("agents.get", { agent: "scout" })).prompt, "Search carefully.");

  const boss = (await env.client.call("agents.list", {})).agents.find(
    (a) => a.slug === "boss" && a.project_id === project,
  );
  assert.ok(boss);
  await env.client.call("agents.update", { agent: boss.id, area: "leadership" });
  const file = fs.readFileSync(path.join(repo, ".apc", "agents", "boss.md"), "utf8");
  assert.match(file, /^area: leadership$/m, "a project agent's area goes to its file");
  assert.equal((await env.client.call("agents.get", { agent: boss.id })).prompt.trim(), "Lead.");

  const th = await env.client.call("threads.create", { kind: "loose", agent_id: "scout" });
  await env.client.call("threads.send", { thread: th.id, text: "hello" });
  await env.settle(th.id);
  const { runs, threads } = await env.client.call("runs.list", { agent: "scout" });
  assert.equal(runs[0]?.thread_id, th.id);
  assert.equal(runs[0]?.agent_id, "scout");
  assert.ok(threads.some((t) => t.id === th.id));
  await assert.rejects(env.client.call("agents.get", { agent: "nobody" }), /not found/);
});

test("install: an executive comes with its routines, on, in the project; installing again does not double them", async () => {
  const { teams } = await env.client.call("agents.templates", {});
  const ceo = teams.find((t) => t.id === "apx:executive-team")?.members.find((m) => m.slug === "ceo");
  assert.deepEqual(
    ceo?.routines.map((r) => r.name),
    ["Weekly review", "Daily pulse"],
    "the template lists what it does on its own",
  );
  const r = await env.client.call("agents.install", {
    project_id: project,
    templates: ["apx:executive-team:ceo", "apx:executive-team:cfo"],
  });
  const ceoId = r.installed.find((a) => a.slug === "ceo")?.id;
  assert.ok(ceoId);
  const names = r.routines.map((x) => `${x.name}:${x.agent_id === ceoId ? "ceo" : "other"}`).sort();
  assert.deepEqual(names, ["Daily pulse:ceo", "Weekly money check:other", "Weekly review:ceo"]);
  for (const x of r.routines) {
    assert.equal(x.project_id, project, "the routine lives in the project");
    assert.equal(x.enabled, true);
    assert.ok(x.next_run_at, "it is scheduled");
  }
  // The executive team makes the project a company, with its members' areas and a role each.
  assert.equal(r.project_kind, "company");
  assert.equal(JSON.parse(fs.readFileSync(path.join(repo, ".apc", "project.json"), "utf8")).kind, "company");
  const org = await env.client.call("org.get", { project });
  assert.deepEqual(
    org.areas.map((a) => [a.slug, a.name]),
    [
      ["leadership", "Leadership"],
      ["finance", "Finance"],
    ],
  );
  assert.deepEqual(
    org.roles.map((x) => [x.slug, x.area]),
    [
      ["ceo", "leadership"],
      ["cfo", "finance"],
    ],
  );
  const again = await env.client.call("agents.install", { project_id: project, templates: ["apx:executive-team:ceo"] });
  assert.equal(again.routines.length, 0);
  const listed = (await env.client.call("routines.list", {})).routines.filter((x) => x.agent_id === ceoId);
  assert.equal(listed.length, 2);
});

test("the base project takes a team as global agents: its shape, its routines, and it becomes a company", async () => {
  const r = await env.client.call("agents.install", {
    templates: ["apx:executive-team:ceo", "apx:executive-team:cfo", "apx:executive-team:coo"],
  });
  assert.deepEqual(
    r.installed.map((a) => [a.id, a.project_id, a.parent ?? "", a.area]),
    [
      ["ceo", undefined, "", "leadership"],
      ["cfo", undefined, "ceo", "finance"],
      ["coo", undefined, "ceo", "operations"],
    ],
  );
  assert.ok(r.routines.length > 0 && r.routines.every((x) => x.project_id === undefined), "global routines");
  assert.equal(r.project_kind, "company");
  assert.equal((await env.client.call("projects.list", {})).base.kind, "company");
  assert.deepEqual(
    (await env.client.call("org.get", {})).areas.map((a) => a.slug),
    ["leadership", "finance", "operations"],
  );
  assert.match((await env.client.call("agents.get", { agent: "cfo" })).prompt, /finance lead/);
  const again = await env.client.call("agents.install", { templates: ["apx:executive-team:cfo"] });
  assert.deepEqual(again.installed, []);
  assert.match(again.skipped[0]?.reason ?? "", /already has cfo/);
});

test("projects.update: name, description and kind go to .apc/project.json, keeping its other keys", async () => {
  const file = path.join(repo, ".apc", "project.json");
  fs.writeFileSync(file, JSON.stringify({ tool: { x: 1 } }));
  const id = project;
  const r = await env.client.call("projects.update", {
    project: id,
    name: "Northwind",
    description: "Wholesale for small shops",
    kind: "company",
  });
  assert.equal(r.project.name, "Northwind");
  assert.equal(r.project.kind, "company");
  assert.equal(r.project.description, "Wholesale for small shops");
  const saved = JSON.parse(fs.readFileSync(file, "utf8"));
  assert.deepEqual(saved.tool, { x: 1 }, "keys APX does not own stay");

  const cleared = await env.client.call("projects.update", { project: id, description: null, kind: null });
  assert.equal(cleared.project.description, undefined);
  assert.equal(cleared.project.kind, undefined);
  assert.equal(cleared.project.name, "Northwind");
  await assert.rejects(env.client.call("projects.update", { project: id, kind: "spaceship" as "app" }));
});
