import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";
import { say, scriptedLlm, startCore } from "../engine/testkit.ts";
import { realpath } from "../paths.ts";
import { removeDir } from "../testkit/platform.ts";

const llm = scriptedLlm(() => say("ok"));
let env: Awaited<ReturnType<typeof startCore>>;
let repo = "";
let project = "";
before(async () => {
  env = await startCore({ llm });
  repo = realpath(fs.mkdtempSync(path.join(os.tmpdir(), "apx-org-")));
  fs.mkdirSync(path.join(repo, ".apc"), { recursive: true });
  fs.writeFileSync(path.join(repo, "AGENTS.md"), "# Northwind\n");
  project = (await env.client.call("projects.register", { path: repo })).project.id;
});
after(async () => {
  await env.core.close();
  await env.cleanup();
  await removeDir(repo);
});

const lastPrompt = async (thread: string) => {
  await env.client.call("threads.send", { thread, text: "hello" });
  await env.settle(thread);
  return String(llm.calls.at(-1)?.messages[0]?.content);
};

test("the base project is named, described and typed by the owner", async () => {
  assert.deepEqual((await env.client.call("projects.list", {})).base, { name: "Default" });
  const r = await env.client.call("projects.update_base", { name: "Acme", description: "Our shop", kind: "company" });
  assert.deepEqual(r.base, { name: "Acme", description: "Our shop", kind: "company" });
  const cleared = await env.client.call("projects.update_base", { description: null });
  assert.deepEqual(cleared.base, { name: "Acme", kind: "company" });
});

test("a project's areas and roles live in .apc/organization.json, v1's format read as it is", async () => {
  const file = path.join(repo, ".apc", "organization.json");
  // v1 wrote nulls for what is missing, and a hand edit may break one entry.
  fs.writeFileSync(
    file,
    JSON.stringify({
      areas: [
        { slug: "finance", name: "Finanzas", goal: null },
        { slug: "Bad Slug", name: "x" },
      ],
      roles: [{ slug: "cfo", name: "Chief Financial Officer", area: "finance", description: null }],
    }),
  );
  assert.deepEqual(await env.client.call("org.get", { project }), {
    areas: [{ slug: "finance", name: "Finanzas" }],
    roles: [{ slug: "cfo", name: "Chief Financial Officer", area: "finance" }],
  });
  // A role whose area is gone stays, as a general role.
  const saved = await env.client.call("org.set", {
    project,
    organization: {
      areas: [{ slug: "growth", name: "Crecimiento", goal: "More customers" }],
      roles: [
        { slug: "cfo", name: "Chief Financial Officer", area: "finance" },
        { slug: "cmo", name: "Chief Marketing Officer", area: "growth" },
      ],
    },
  });
  assert.deepEqual(saved.roles, [
    { slug: "cfo", name: "Chief Financial Officer" },
    { slug: "cmo", name: "Chief Marketing Officer", area: "growth" },
  ]);
  assert.deepEqual(JSON.parse(fs.readFileSync(file, "utf8")), saved);

  // The project's agents read its kind and its areas and roles.
  await env.client.call("projects.update", { project, kind: "company" });
  const t = await env.client.call("threads.create", {
    kind: "loose",
    agent_id: "roby",
    project_id: project,
    title: "org",
  });
  const prompt = await lastPrompt(t.id);
  assert.match(prompt, /It is a company project\./);
  assert.match(
    prompt,
    /- Area Crecimiento: More customers\n- Role Chief Financial Officer\n- Role Chief Marketing Officer \(Crecimiento\)/,
  );
});

test("the base project's areas and roles are kept by APX and reach the chats outside any project", async () => {
  await env.client.call("org.set", {
    organization: {
      areas: [{ slug: "direction", name: "Dirección" }],
      roles: [{ slug: "ceo", name: "CEO", area: "direction" }],
    },
  });
  assert.equal((await env.client.call("org.get", {})).roles[0]?.name, "CEO");
  const prompt = await lastPrompt("home");
  assert.match(prompt, /## Project: Acme\nIt is a company project\./);
  assert.match(prompt, /- Role CEO \(Dirección\)/);
});

test("an organization.json saved with a BOM is read as written", async () => {
  fs.writeFileSync(
    path.join(repo, ".apc", "organization.json"),
    `\uFEFF${JSON.stringify({ areas: [{ slug: "sales", name: "Ventas" }], roles: [] })}`,
  );
  assert.deepEqual((await env.client.call("org.get", { project })).areas, [{ slug: "sales", name: "Ventas" }]);
});
