import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";
import { say, scriptedLlm, startCore } from "../engine/testkit.ts";

let env: Awaited<ReturnType<typeof startCore>>;
let home = "";
let repo = "";
let project = "";

before(async () => {
  home = fs.mkdtempSync(path.join(os.tmpdir(), "apx2-team-"));
  // The owner's v1 vault (inside the test home): one loose agent and a link that must never be followed.
  const vault = path.join(home, "v1", "agents");
  fs.mkdirSync(vault, { recursive: true });
  fs.writeFileSync(
    path.join(vault, "scout.md"),
    "---\nname: Scout\nrole: Research\narea: research\n---\n\nFind things.\n",
  );
  fs.symlinkSync("/etc", path.join(vault, "linked"));
  env = await startCore({ llm: scriptedLlm(() => say("ok")), home });
  repo = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "apx2-team-repo-")));
  fs.mkdirSync(path.join(repo, ".apc", "agents"), { recursive: true });
  fs.writeFileSync(path.join(repo, ".apc", "agents", "boss.md"), "---\nname: Boss\nrole: Orchestrator\n---\n\nLead.\n");
  project = (await env.client.call("projects.register", { path: repo })).project.id;
});
after(async () => {
  await env.core.close();
  env.cleanup();
  fs.rmSync(repo, { recursive: true, force: true });
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
  const file = fs.readFileSync(path.join(repo, ".apc", "agents", "security.md"), "utf8");
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
