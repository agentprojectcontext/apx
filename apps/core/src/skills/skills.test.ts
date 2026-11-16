import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { after, before, test } from "node:test";
import { callTool, say, scriptedLlm, startCore } from "../engine/testkit.ts";
import { realpath } from "../paths.ts";
import { removeDir } from "../testkit/platform.ts";

const llm = scriptedLlm((req, { said, afterTool }) => {
  if (afterTool) return say(`Loaded: ${String(req.messages.at(-1)?.content).slice(0, 200)}`);
  if (said.includes("use the skill")) return callTool("k1", "load_skill", { name: "brief-writer" });
  if (said.includes("empty file")) return callTool("k3", "load_skill", { name: "brief-writer", file: "" });
  if (said.includes("folder")) return callTool("k4", "load_skill", { name: "brief-writer", file: "refs" });
  if (said.includes("how do I add an MCP")) return callTool("k5", "load_skill", { name: "apx-mcps" });
  if (said.includes("escape"))
    return callTool("k2", "load_skill", { name: "brief-writer", file: "../../secrets.index.json" });
  return say("ok");
});

let env: Awaited<ReturnType<typeof startCore>>;
before(async () => {
  env = await startCore({ llm });
  const dir = path.join(env.home, "skills", "brief-writer");
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    path.join(dir, "SKILL.md"),
    "---\nname: brief-writer\ndescription: Writes one-page briefs. Use it for client summaries.\n---\n\nStart with the goal.\n",
  );
  fs.mkdirSync(path.join(dir, "refs"));
  fs.writeFileSync(path.join(dir, "refs", "tone.md"), "Plain words.\n");
});
after(async () => {
  await env.core.close();
  await env.cleanup();
});

test("agents see a one-line catalog and load the body on demand; files outside the skill are refused", async () => {
  const { skills } = await env.client.call("skills.list", {});
  assert.deepEqual(
    skills.filter((s) => s.source !== "apx").map((s) => s.name),
    ["brief-writer"],
  );
  const t = await env.client.call("threads.create", { kind: "loose", agent_id: "superagent", title: "skills" });
  await env.client.call("threads.send", { thread: t.id, text: "use the skill" });
  await env.settle(t.id);
  const system = String(llm.calls.at(-1)?.messages[0]?.content);
  assert.match(system, /## Skills[\s\S]*- brief-writer: Writes one-page briefs\./);
  assert.doesNotMatch(system, /Start with the goal/);
  assert.match(String(llm.calls.at(-1)?.messages.at(-1)?.content), /Start with the goal/);
  await env.client.call("threads.send", { thread: t.id, text: "escape" });
  await env.settle(t.id);
  assert.match(String(llm.calls.at(-1)?.messages.at(-1)?.content), /outside the skill/);
});

test("APX's own skills: named in one sentence, loaded on demand, always on, read-only, and they keep their names", async () => {
  // The owner's skill with the same name as one of APX's does not replace it.
  const dir = path.join(env.home, "skills", "apx-mcps");
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "SKILL.md"), "---\nname: apx-mcps\ndescription: Edit ~/.apx/mcps.json.\n---\n");
  const { skills } = await env.client.call("skills.list", {});
  const apx = skills.filter((s) => s.source === "apx");
  assert.ok(apx.some((s) => s.name === "apx-mcps") && apx.some((s) => s.name === "apx-variables"));
  assert.ok(apx.every((s) => s.on && !s.editable));
  assert.equal(skills.filter((s) => s.name === "apx-mcps").length, 1);
  await assert.rejects(env.client.call("skills.toggle", { name: "apx-mcps", on: false }), /always on/);
  await assert.rejects(
    env.client.call("skills.save", { name: "apx-mcps", target: "global", content: "---\nname: apx-mcps\n---\n" }),
    /comes with APX/,
  );

  const t = await env.client.call("threads.create", { kind: "loose", agent_id: "superagent", title: "apx skills" });
  await env.client.call("threads.send", { thread: t.id, text: "how do I add an MCP" });
  await env.settle(t.id);
  const system = String(llm.calls.at(-1)?.messages[0]?.content);
  assert.match(system, /APX guides \(apx-[^)]*apx-mcps[^)]*apx-projects[^)]*\): load_skill the right one first/);
  assert.doesNotMatch(system, /- apx-mcps:/, "not one catalog line each");
  const loaded = String(llm.calls.at(-1)?.messages.at(-1)?.content);
  assert.match(loaded, /apx mcps add/);
  assert.doesNotMatch(loaded, /Edit ~\/\.apx\/mcps\.json/);
  await removeDir(dir);
});

test("an empty file argument loads SKILL.md, and a folder lists its files instead of failing", async () => {
  const t = await env.client.call("threads.create", { kind: "loose", agent_id: "superagent", title: "skill args" });
  await env.client.call("threads.send", { thread: t.id, text: "empty file" });
  await env.settle(t.id);
  const loaded = String(llm.calls.at(-1)?.messages.at(-1)?.content);
  assert.match(loaded, /Start with the goal/);
  assert.match(loaded, /refs\/tone\.md/);
  await env.client.call("threads.send", { thread: t.id, text: "folder" });
  await env.settle(t.id);
  assert.match(
    String(llm.calls.at(-1)?.messages.at(-1)?.content),
    /refs is a folder, not a file\. Its files: tone\.md/,
  );
});

test("v1 skills are copied once: folders without inner links, linked skills stay links, existing names kept", async () => {
  const { importSkills } = await import("../import/v1.ts");
  const v1 = fs.mkdtempSync(path.join(env.home, "v1-"));
  const outside = fs.mkdtempSync(path.join(env.home, "outside-"));
  fs.writeFileSync(path.join(outside, "SKILL.md"), "---\nname: linked\ndescription: Lives elsewhere.\n---\n");
  fs.mkdirSync(path.join(v1, "plain"));
  fs.writeFileSync(path.join(v1, "plain", "SKILL.md"), "---\nname: plain\ndescription: A plain one.\n---\n");
  fs.symlinkSync(outside, path.join(v1, "plain", "leak"));
  fs.symlinkSync(outside, path.join(v1, "linked"));
  fs.mkdirSync(path.join(v1, "brief-writer"));
  fs.writeFileSync(path.join(v1, "brief-writer", "SKILL.md"), "---\nname: brief-writer\ndescription: Old.\n---\n");
  fs.mkdirSync(path.join(v1, "not-a-skill"));
  const to = path.join(env.home, "skills");
  assert.deepEqual(importSkills(v1, to), ["linked", "plain"]);
  assert.equal(fs.existsSync(path.join(to, "plain", "leak")), false);
  assert.equal(realpath(path.join(to, "linked")), realpath(outside));
  assert.match(fs.readFileSync(path.join(to, "brief-writer", "SKILL.md"), "utf8"), /one-page briefs/);
  assert.deepEqual(importSkills(v1, to), []);
  for (const n of ["linked", "plain"]) await removeDir(path.join(to, n));
});

test("a warm catalog sees edits, replacement files, removal and the current skill body", async () => {
  const dir = path.join(env.home, "skills", "freshness");
  const file = path.join(dir, "SKILL.md");
  const content = (description: string, body: string) =>
    `---\nname: freshness\ndescription: ${description}\n---\n${body}`;
  fs.mkdirSync(dir);
  fs.writeFileSync(file, content("Original.", "Old body"));
  const listed = async () => (await env.client.call("skills.list", {})).skills.find((s) => s.name === "freshness");
  assert.equal((await listed())?.description, "Original.");
  assert.equal((await listed())?.description, "Original.");
  fs.writeFileSync(file, content("Edited description.", "Edited body"));
  assert.equal((await listed())?.description, "Edited description.");
  const replacement = path.join(dir, "replacement.md");
  fs.writeFileSync(replacement, content("Replaced description.", "Replacement body"));
  fs.renameSync(replacement, file);
  assert.equal((await listed())?.description, "Replaced description.");
  const { skillsFor, readSkillFile } = await import("./skills.ts");
  const skill = skillsFor(env.core.store, { home: env.home }, undefined).find((s) => s.name === "freshness");
  assert.ok(skill);
  assert.match(readSkillFile(skill), /Replacement body/);
  fs.writeFileSync(file, content("Replaced description.", "Newest body"));
  assert.match(readSkillFile(skill), /Newest body/);
  fs.unlinkSync(file);
  assert.equal(await listed(), undefined);
  await removeDir(dir);
});

test("a long catalog describes the project's skills and the first ones, and names the rest", async () => {
  const { skillCatalog } = await import("./skills.ts");
  const skill = (name: string, scope: "global" | "project" = "global") => ({
    name,
    description: `Does ${name} things, with a long explanation that goes on well past what one catalog line should carry. Second sentence.`,
    scope,
    dir: `/skills/${name}`,
    source: "owner" as const,
    own: true,
    copies: [],
  });
  const many = Array.from({ length: 130 }, (_, i) => skill(`s${String(i).padStart(3, "0")}`));
  const catalog = skillCatalog([...many, skill("zz-project", "project")]);
  const lines = catalog.split("\n");
  assert.equal(lines.filter((l) => l.startsWith("- ")).length, 30);
  assert.match(lines.find((l) => l.startsWith("- ")) ?? "", /^- zz-project: /, "the project's own skill first");
  assert.ok(
    lines.every((l) => !l.startsWith("- ") || l.length <= 120),
    "short lines",
  );
  assert.match(catalog, /Also: s029, s030, .*s118\./, "the rest by name");
  assert.match(catalog, /\(11 more not listed; load_skill works with any skill's name\)/);
});
