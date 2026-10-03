import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";
import { say, scriptedLlm, startCore } from "../engine/testkit.ts";

let env: Awaited<ReturnType<typeof startCore>>;
let repo = "";

before(async () => {
  env = await startCore({ llm: scriptedLlm(() => say("ok")) });
  repo = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "apx2-int-")));
  fs.writeFileSync(path.join(repo, "AGENTS.md"), "# Acme\n");
});
after(async () => {
  await env.core.close();
  env.cleanup();
  fs.rmSync(repo, { recursive: true, force: true });
});

test("connecting an integration stores its token and adds its server; it can be off in a project; disconnecting removes both", async () => {
  const project = (await env.client.call("projects.register", { path: repo })).project.id;
  const list = async () => (await env.client.call("integrations.list", {})).integrations;
  assert.equal((await list()).find((i) => i.id === "github")?.connected, false);
  assert.ok(
    (await list()).some((i) => i.coming),
    "the ones still coming are listed",
  );

  await assert.rejects(env.client.call("integrations.connect", { id: "slack", values: { token: "xoxb-1" } }));
  await env.client.call("integrations.connect", { id: "github", values: { token: "ghp_example0000" } });
  const servers = (await env.client.call("mcp.list", {})).servers;
  const gh = servers.find((s) => s.name === "github");
  assert.ok(gh, "the server is a global one");
  assert.ok(!JSON.stringify(servers).includes("ghp_example0000"), "the token never shows");
  assert.ok(env.core.secrets.has("secret://github-token"));

  await env.client.call("mcp.toggle", { project, server: "github", on: false });
  assert.deepEqual((await list()).find((i) => i.id === "github")?.off_in, [project]);

  await env.client.call("integrations.disconnect", { id: "github" });
  assert.equal((await list()).find((i) => i.id === "github")?.connected, false);
  assert.ok(!env.core.secrets.has("secret://github-token"));
  assert.ok(!(await env.client.call("mcp.list", {})).servers.some((s) => s.name === "github"));
});
