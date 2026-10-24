import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";
import { callTool, say, scriptedLlm, startCore } from "../engine/testkit.ts";
import { realpath } from "../paths.ts";
import { removeDir } from "../testkit/platform.ts";

// The test config puts the other apps under APX's home: Claude in claude-home/, Codex in codex-home/, Cursor and the
// shared folder in .cursor/ and .agents/.
let env: Awaited<ReturnType<typeof startCore>>;
let home = "";
let repo = "";
let project = "";

const skill = (dir: string, name: string, description: string) => {
  fs.mkdirSync(path.join(dir, name), { recursive: true });
  fs.writeFileSync(path.join(dir, name, "SKILL.md"), `---\nname: ${name}\ndescription: ${description}\n---\n\nHow.\n`);
};

const llm = scriptedLlm((_req, { said, afterTool }) => {
  if (afterTool) return say("done");
  if (said.includes("use codex's")) return callTool("c1", "load_skill", { name: "release-notes" });
  return say("ok");
});

before(async () => {
  home = fs.mkdtempSync(path.join(os.tmpdir(), "apx-skill-apps-"));
  skill(path.join(home, "skills"), "pdf", "APX's own copy.");
  skill(path.join(home, "claude-home", "skills"), "pdf", "Claude's copy.");
  skill(path.join(home, "claude-home", "skills"), "slides", "Makes decks.");
  // APX writes its own skills into the apps' folders: those stay APX's.
  skill(path.join(home, "claude-home", "skills"), "apx", "Use APX from Claude Code.");
  skill(path.join(home, "codex-home", "skills"), "release-notes", "Writes release notes.");
  skill(path.join(home, ".cursor", "skills"), "slides", "Makes decks.");
  skill(path.join(home, ".agents", "skills"), "shared", "Linked from the shared folder.");
  fs.symlinkSync(path.join(home, ".agents", "skills", "shared"), path.join(home, "skills", "shared"));
  env = await startCore({ llm, home });
  repo = realpath(fs.mkdtempSync(path.join(os.tmpdir(), "apx-skill-apps-repo-")));
  fs.writeFileSync(path.join(repo, "AGENTS.md"), "# Acme\n");
  skill(path.join(repo, ".claude", "skills"), "deploy", "Deploys Acme.");
  project = (await env.client.call("projects.register", { path: repo })).project.id;
});
after(async () => {
  await env.core.close();
  await env.cleanup();
  await removeDir(repo);
});

test("the other apps' skills are listed with their app; a name found twice is one skill with its copies", async () => {
  const { skills } = await env.client.call("skills.list", {});
  const by = (name: string) => skills.find((s) => s.name === name);
  assert.equal(by("release-notes")?.source, "codex");
  assert.equal(by("release-notes")?.editable, false, "changed in Codex, or copied into APX");
  assert.equal(by("apx"), undefined, "APX's copy in Claude's folder is not Claude's skill");

  const pdf = by("pdf");
  assert.equal(pdf?.source, "owner", "APX's own copy wins the name");
  assert.deepEqual(
    pdf?.copies.map((c) => [c.source, c.same]),
    [["claude", false]],
  );
  const slides = by("slides");
  assert.equal(slides?.source, "claude");
  assert.deepEqual(
    slides?.copies.map((c) => [c.source, c.same]),
    [["cursor", true]],
  );
  // Linked into APX's folder from the shared one: one skill, the shared folder's, and no copy of itself.
  assert.equal(by("shared")?.source, "agents");
  assert.equal(by("shared")?.editable, true);
  assert.deepEqual(by("shared")?.copies, []);
});

test("a project's own app folders count as its skills, and agents load another app's skill by name", async () => {
  const { skills } = await env.client.call("skills.list", { project });
  const deploy = skills.find((s) => s.name === "deploy");
  assert.deepEqual([deploy?.source, deploy?.scope, deploy?.project_id], ["claude", "project", project]);
  assert.equal(
    (await env.client.call("skills.list", {})).skills.find((s) => s.name === "deploy"),
    undefined,
  );

  const t = await env.client.call("threads.create", { kind: "loose", agent_id: "roby", title: "apps" });
  await env.client.call("threads.send", { thread: t.id, text: "use codex's" });
  await env.settle(t.id);
  assert.match(String(llm.calls.at(-2)?.messages[0]?.content), /- release-notes: Writes release notes\./);
  assert.match(String(llm.calls.at(-1)?.messages.at(-1)?.content), /How\./);
});

test("copying another app's skill into APX makes it APX's: it wins the name and the app's stays as a copy", async () => {
  const source = { kind: "folder" as const, path: path.join(home, "codex-home", "skills", "release-notes") };
  const r = await env.client.call("skills.import", { source, target: "global", pick: ["."] });
  assert.deepEqual(
    r.imported.map((s) => [s.name, s.source, s.editable]),
    [["release-notes", "owner", true]],
  );
  assert.deepEqual(
    r.imported[0]?.copies.map((c) => [c.source, c.same]),
    [["codex", true]],
  );
});
