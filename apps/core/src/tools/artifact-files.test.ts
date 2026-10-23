import assert from "node:assert/strict";
import path from "node:path";
import { after, before, test } from "node:test";
import { callTool, say, scriptedLlm, startCore } from "../engine/testkit.ts";
import { artifactOfFile } from "./artifact-files.ts";
import { artifactSources } from "./folders.ts";

test("only a page where artifact pages live names an artifact", () => {
  const root = artifactSources("/h", "p_acme");
  assert.equal(artifactOfFile("/h", "p_acme", path.join(root, "expenses", "index.html")), "expenses");
  assert.equal(artifactOfFile("/h", "p_acme", path.join(root, "expenses", "dist", "index.html")), "expenses");
  assert.equal(artifactOfFile("/h", "p_acme", path.join(root, "expenses", "src", "main.jsx")), undefined);
  assert.equal(artifactOfFile("/h", "p_acme", path.join(root, "Bad_Name", "index.html")), undefined);
  assert.equal(
    artifactOfFile("/h", "p_acme", path.join(artifactSources("/h", "p_other"), "x", "index.html")),
    undefined,
  );
  assert.equal(artifactOfFile("/h", "p_acme", "/elsewhere/index.html"), undefined);
});

// The owner's message is the call to make: `{"name": "file_write", "args": {...}}`.
const llm = scriptedLlm((req, { said, afterTool }) => {
  if (afterTool) return say(String(req.messages.at(-1)?.content));
  if (!said.startsWith("{")) return say("ok");
  const { name, args } = JSON.parse(said) as { name: string; args: object };
  return callTool("c1", name, args);
});

let env: Awaited<ReturnType<typeof startCore>>;
before(async () => {
  env = await startCore({ llm });
});
after(async () => {
  await env.core.close();
  env.cleanup();
});

test("saving an artifact's page with the file tools shows it, and editing it makes a new version", async () => {
  const t = await env.client.call("threads.create", { kind: "agent", agent_id: "roby" });
  const file = path.join(artifactSources(env.home, undefined), "pantry", "index.html");
  const say = async (name: string, args: object) => {
    await env.client.call("threads.send", { thread: t.id, text: JSON.stringify({ name, args }) });
    await env.settle(t.id);
    return String(llm.calls.at(-1)?.messages.at(-1)?.content);
  };
  const page = `<!doctype html><title>Pantry</title><meta name="apx-surface" content="app"><h1>Pantry</h1>`;
  const wrote = await say("file_write", { path: file, content: page });
  assert.match(wrote, /Artifact "pantry" v1 shown \(app\)/);
  const made = env.core.store.surfaces.byName(undefined, "pantry");
  assert.equal(made?.title, "Pantry");
  assert.equal(made?.app, true);
  assert.equal(made?.created_by, "roby");

  const edited = await say("file_edit", { path: file, old: "<h1>Pantry</h1>", new: "<h1>Pantry list</h1>" });
  assert.match(edited, /Artifact "pantry" v2 shown/);
  assert.match(env.core.store.surfaces.byName(undefined, "pantry")?.html ?? "", /Pantry list/);

  // A script that does not parse is refused before anything is shown.
  const broken = await say("file_write", { path: file, content: `${page}<script>let x = ;</script>` });
  assert.match(broken, /Not shown as artifact "pantry"/);
  assert.equal(env.core.store.surfaces.byName(undefined, "pantry")?.version, 2);

  // Built from files, it is not retyped through show_widget or edit_widget: one copy, in its folder.
  const retyped = await say("show_widget", { name: "pantry", title: "Pantry", html: "<h1>Other</h1>" });
  assert.match(retyped, /refused: "pantry" is built from files/);
  const htmlEdit = await say("edit_widget", { name: "pantry", edits: [{ old: "Pantry list", new: "x" }] });
  assert.match(htmlEdit, /refused: "pantry" is built from files/);
  assert.equal(env.core.store.surfaces.byName(undefined, "pantry")?.version, 2);
});
