import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { AGENT_DIR } from "../apc/folder.ts";
import type { startCore } from "../engine/testkit.ts";

export async function migrationRuntimeFixture(env: Awaited<ReturnType<typeof startCore>>, folder: string) {
  for (const name of ["acme", "northwind"]) {
    const root = path.join(folder, name);
    fs.mkdirSync(path.join(root, AGENT_DIR, "agents"), { recursive: true });
    fs.writeFileSync(path.join(root, AGENT_DIR, "project.json"), JSON.stringify({ name }));
    fs.writeFileSync(path.join(root, "AGENTS.md"), `# ${name}\n${name}-context-marker\n`);
  }
  const sourceRoot = path.join(folder, "acme");
  const targetRoot = path.join(folder, "northwind");
  for (const name of ["researcher", "editor"])
    fs.writeFileSync(
      path.join(sourceRoot, AGENT_DIR, "agents", `${name}.md`),
      `---\nname: ${name}\nrole: Research\n---\n\nCheck evidence.\n`,
    );
  const source = (await env.client.call("projects.register", { path: sourceRoot })).project;
  const target = (await env.client.call("projects.register", { path: targetRoot })).project;
  const agents = (await env.client.call("agents.list", { project_id: source.id })).agents;
  const researcher = agents.find((a) => a.slug === "researcher");
  const editor = agents.find((a) => a.slug === "editor");
  assert.ok(researcher && editor);
  fs.mkdirSync(path.join(sourceRoot, "reports"));
  fs.writeFileSync(path.join(sourceRoot, "reports", "result.txt"), "Destination-only findings");
  const store = env.core.store;
  const shared = store.threads.create({
    kind: "task",
    project_id: source.id,
    title: "Migration report",
    agent_ids: [editor.id],
  });
  const task = store.tasks.create({
    title: "Migration report",
    status: "doing",
    project_id: source.id,
    assignee: editor.id,
    thread_id: shared.id,
    by: "owner",
  });
  const own = store.threads.create({
    kind: "agent",
    project_id: source.id,
    title: "Research",
    agent_ids: [researcher.id],
    task_id: task.id,
    parent_id: shared.id,
  });
  store.tasks.change(task.id, { state: "done" }, "owner");
  store.messages.add({
    thread_id: shared.id,
    author: { kind: "user" },
    parts: [{ type: "text", text: "Migration report: Destination-only findings" }],
  });
  const note = store.memories.add({
    scope: "agent",
    project_id: source.id,
    agent_id: researcher.id,
    text: "destination-private-note",
    source: "owner",
    thread_id: own.id,
  });
  const mediaPath = path.join(env.home, "report.txt");
  fs.writeFileSync(mediaPath, "Attachment contents");
  const media = store.media.add({ kind: "file", mime: "text/plain", bytes: 19, path: mediaPath, thread_id: shared.id });
  return { sourceRoot, targetRoot, source, target, researcher, editor, store, shared, task, own, note, media };
}
