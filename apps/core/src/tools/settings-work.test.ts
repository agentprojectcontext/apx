import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { settingsCore } from "./settings.test-support.ts";

let h: Awaited<ReturnType<typeof settingsCore>>;
before(async () => {
  h = await settingsCore();
});
after(async () => {
  await h.env.core.close();
  await h.env.cleanup();
});

const projects = async () => (await h.env.client.call("projects.list", {})).projects;

test("projects: created and renamed once the owner approves; autonomy stays theirs", async () => {
  await h.ask({ method: "projects.create", params: { name: "Northwind" } }, "deny");
  const made = await h.ask({ method: "projects.create", params: { name: "Acme", kind: "company" } }, "approve");
  assert.equal(made.detail, 'Create the project Acme\nkind: "company"');
  const names = (await projects()).map((p) => p.name);
  assert.ok(names.includes("Acme") && !names.includes("Northwind"));
  const acme = (await projects()).find((p) => p.name === "Acme")?.id ?? "";
  assert.match((await h.ask({ method: "projects.list" })).answer, new RegExp(`- Acme \\[${acme}\\] \\(company`));
  const { detail } = await h.ask(
    { method: "projects.update", params: { project: acme, name: "Acme Labs" } },
    "approve",
  );
  assert.equal(detail, 'Change the project Acme\nname: "Acme" → "Acme Labs"');
  assert.equal((await projects()).find((p) => p.id === acme)?.name, "Acme Labs");
  const total = { method: "projects.update", params: { project: acme, autonomy: "total" } };
  assert.match((await h.ask(total)).answer, /autonomy stays the owner's/);
  const folders = { method: "projects.update", params: { project: acme, read_only_folders: [] } };
  assert.match((await h.ask(folders)).answer, /read_only_folders stays the owner's/);
});

test("memory: its settings change and keep its model; the model stays the owner's", async () => {
  const settings = () => h.env.client.call("memory.settings", {});
  const aux = (await settings()).aux_model;
  const { detail } = await h.ask({ method: "memory.set_settings", params: { auto_recall: false } }, "approve");
  assert.equal(detail, "Change how memory works\nauto_recall: true → false");
  assert.equal((await settings()).auto_recall, false);
  assert.equal((await settings()).aux_model, aux);
  await h.ask({ method: "memory.set_settings", params: { mode: "off" } }, "deny");
  assert.equal((await settings()).mode, "notes");
  const model = { method: "memory.set_settings", params: { aux_model: "fake/fake-2" } };
  assert.match((await h.ask(model)).answer, /aux_model stays the owner's/);
});

test("skills and servers: a skill written, turned off, and a project's global servers, each once approved", async () => {
  const content = "---\nname: acme-notes\ndescription: How Acme writes its notes.\n---\nWrite short notes.";
  const saved = await h.ask(
    { method: "skills.save", params: { name: "acme-notes", target: "global", content } },
    "approve",
  );
  assert.match(saved.detail, /^Save the skill acme-notes\ntarget: "global"\ncontent: "---/);
  const skill = async () => (await h.env.client.call("skills.list", {})).skills.find((s) => s.name === "acme-notes");
  assert.equal((await skill())?.on, true);
  const off = await h.ask({ method: "skills.toggle", params: { name: "acme-notes", on: false } }, "approve");
  assert.equal(off.detail, "Turn the skill acme-notes off");
  assert.equal((await skill())?.on, false);
  await h.ask({ method: "skills.toggle", params: { name: "acme-notes", on: true } }, "deny");
  assert.equal((await skill())?.on, false);
  const zip = {
    method: "skills.import",
    params: { source: { kind: "zip", data: "UEs=" }, target: "global", pick: ["x"] },
  };
  assert.match((await h.ask(zip)).answer, /a zip comes from the owner's computer/);

  const acme = (await projects()).find((p) => p.name === "Acme Labs")?.id ?? "";
  const inherit = (on: boolean) => ({ method: "resources.inherit", params: { project: acme, kind: "mcp", on } });
  await h.ask(inherit(false), "deny");
  const mcp = async () => (await h.env.client.call("resources.inheritance", { project: acme })).mcp;
  assert.equal(await mcp(), true);
  const { detail } = await h.ask(inherit(false), "approve");
  assert.equal(detail, "Stop the project Acme Labs using the global MCP servers");
  assert.equal(await mcp(), false);
});

test("media services: the image defaults change only where asked", async () => {
  const { detail } = await h.ask({ method: "services.defaults", params: { width: 1024 } }, "approve");
  assert.equal(detail, "Change the image defaults\nwidth: 512 → 1024");
  const defaults = async () => (await h.env.client.call("services.list", {})).image_defaults;
  assert.equal((await defaults()).width, 1024);
  assert.equal((await defaults()).height, 512);
  await h.ask({ method: "services.defaults", params: { steps: 50 } }, "deny");
  assert.equal((await defaults()).steps, 20);
  assert.match((await h.ask({ method: "services.list" })).answer, /image defaults: .*"width":1024/);
});

test("widgets: deleting one for good waits for the owner", async () => {
  const keep = h.env.core.store.surfaces.upsert({
    name: "acme-board",
    title: "Acme board",
    html: "<p>a</p>",
    created_by: "roby",
  });
  const drop = h.env.core.store.surfaces.upsert({
    name: "acme-old",
    title: "Acme old",
    html: "<p>b</p>",
    created_by: "roby",
  });
  await h.ask({ method: "surfaces.remove", params: { surface: keep.id } }, "deny");
  const { detail } = await h.ask({ method: "surfaces.remove", params: { surface: drop.id } }, "approve");
  assert.equal(detail, "Delete for good the widget Acme old and what it remembers");
  const left = (await h.env.client.call("surfaces.list", {})).surfaces.map((s) => s.id);
  assert.ok(left.includes(keep.id) && !left.includes(drop.id));
});
