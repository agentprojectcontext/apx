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
const repos: string[] = [];
let from = "";
let to = "";

const repo = (agents: Record<string, string>) => {
  const dir = realpath(fs.mkdtempSync(path.join(os.tmpdir(), "apx-clone-")));
  repos.push(dir);
  fs.mkdirSync(path.join(dir, ".apc", "agents"), { recursive: true });
  for (const [slug, text] of Object.entries(agents))
    fs.writeFileSync(path.join(dir, ".apc", "agents", `${slug}.md`), text);
  return dir;
};

before(async () => {
  env = await startCore({ llm: scriptedLlm(() => say("ok")) });
  const acme = repo({
    lead: "---\nname: Lead\nrole: Orchestrator\ntools: [shell, files]\n---\n\nRun the team.\n",
    writer: "---\nname: Writer\nrole: Copy\nparent: lead\narea: marketing\nskills: [seo]\n---\n\nWrite well.\n",
  });
  const northwind = repo({ boss: "---\nname: Boss\nrole: Orchestrator\n---\n\nLead.\n" });
  from = (await env.client.call("projects.register", { path: acme })).project.id;
  to = (await env.client.call("projects.register", { path: northwind })).project.id;
});
after(async () => {
  await env.core.close();
  await env.cleanup();
  for (const r of repos) await removeDir(r);
});

const team = async (project: string) =>
  (await env.client.call("agents.list", {})).agents.filter((a) => a.project_id === project);

test("cloning a team copies each definition and keeps reports under their cloned boss", async () => {
  const ids = (await team(from)).map((a) => a.id);
  const r = await env.client.call("agents.clone", { agents: ids, project_id: to, hang_under: "boss" });
  assert.deepEqual(r.skipped, []);
  const lead = r.cloned.find((a) => a.name === "Lead");
  const writer = r.cloned.find((a) => a.name === "Writer");
  assert.equal(lead?.parent, "boss");
  assert.equal(writer?.parent, lead?.slug);
  assert.deepEqual(writer?.skills, ["seo"]);
  assert.equal(writer?.area, "marketing");
  assert.deepEqual(lead?.tools, ["shell", "files"]);
  const { prompt } = await env.client.call("agents.get", { agent: writer?.id ?? "" });
  assert.equal(prompt.trim(), "Write well.");
});

test("rename gives each copy a name nobody uses; the super-agent and same-project copies without it are refused", async () => {
  const ids = (await team(from)).map((a) => a.id);
  const r = await env.client.call("agents.clone", { agents: [...ids, "roby"], project_id: to, rename: true });
  assert.equal(r.cloned.length, 2);
  const used = (await env.client.call("agents.list", {})).agents.map((a) => a.name);
  for (const a of r.cloned) {
    assert.ok((AGENT_NAMES as readonly string[]).includes(a.name), a.name);
    assert.equal(used.filter((n) => n === a.name).length, 1, `${a.name} is used once`);
  }
  assert.match(r.skipped[0]?.reason ?? "", /super-agent/);
  const again = await env.client.call("agents.clone", { agents: [ids[0] ?? ""], project_id: from });
  assert.match(again.skipped[0]?.reason ?? "", /already in this project/);
});
