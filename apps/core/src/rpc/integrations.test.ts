import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";
import { say, scriptedLlm, startCore } from "../engine/testkit.ts";
import { realpath } from "../paths.ts";
import { removeDir } from "../testkit/platform.ts";

let env: Awaited<ReturnType<typeof startCore>>;
let repo = "";

before(async () => {
  env = await startCore({ llm: scriptedLlm(() => say("ok")) });
  repo = realpath(fs.mkdtempSync(path.join(os.tmpdir(), "apx-int-")));
  fs.writeFileSync(path.join(repo, "AGENTS.md"), "# Acme\n");
});
after(async () => {
  await env.core.close();
  await env.cleanup();
  await removeDir(repo);
});

test("connecting an integration stores its token and adds its server; it can be off in a project; disconnecting removes both", async () => {
  const project = (await env.client.call("projects.register", { path: repo })).project.id;
  const list = async () => (await env.client.call("integrations.list", {})).integrations;
  assert.equal((await list()).find((i) => i.id === "github")?.connected, false);
  assert.ok(
    (await list()).some((i) => i.coming),
    "the ones still coming are listed",
  );

  await assert.rejects(env.client.call("integrations.connect", { id: "slack", values: { token: " " } }), /Bot token/);
  await env.client.call("integrations.connect", { id: "github", values: { token: "ghp_example0000" } });
  const servers = (await env.client.call("mcp.list", {})).servers;
  const gh = servers.find((s) => s.name === "github");
  assert.ok(gh, "the server is a global one");
  assert.equal(gh.transport, "http", "GitHub's own server, reached at its address");
  assert.ok(!JSON.stringify(servers).includes("ghp_example0000"), "the token never shows");
  assert.ok(env.core.secrets.has("secret://github-token"));

  await env.client.call("mcp.toggle", { project, server: "github", on: false });
  assert.deepEqual((await list()).find((i) => i.id === "github")?.off_in, [project]);

  await env.client.call("integrations.disconnect", { id: "github" });
  assert.equal((await list()).find((i) => i.id === "github")?.connected, false);
  assert.ok(!env.core.secrets.has("secret://github-token"));
  assert.ok(!(await env.client.call("mcp.list", {})).servers.some((s) => s.name === "github"));
});

test("a connected integration is edited: what is typed changes, what is left empty keeps its value", async () => {
  const ha = async () =>
    (await env.client.call("integrations.list", {})).integrations.find((i) => i.id === "home-assistant");
  const values = { server: "http://homeassistant.local:8123/", token: "example-ha-token" };
  await env.client.call("integrations.connect", { id: "home-assistant", values });
  assert.deepEqual(
    (await ha())?.fields.map((f) => [f.name, f.set, f.value]),
    [
      ["server", undefined, "http://homeassistant.local:8123/"],
      ["token", true, undefined],
    ],
    "a token only says it is stored; an address comes back as typed",
  );
  const server = (await env.client.call("mcp.list", {})).servers.find((s) => s.name === "home-assistant");
  assert.equal(server?.transport, "http");
  await env.client.call("integrations.connect", {
    id: "home-assistant",
    values: { server: "http://ha.example.org:8123", token: "" },
  });
  assert.equal(env.core.secrets.resolve("secret://home-assistant-token"), "example-ha-token", "the token stays");
  assert.equal((await ha())?.fields.find((f) => f.name === "server")?.value, "http://ha.example.org:8123");
  await env.client.call("integrations.disconnect", { id: "home-assistant" });
});

test("an app that signs in through the browser connects with nothing to type", async () => {
  const linear = async () =>
    (await env.client.call("integrations.list", {})).integrations.find((i) => i.id === "linear");
  assert.deepEqual((await linear())?.fields, []);
  assert.equal((await linear())?.coming, false);
  await env.client.call("integrations.connect", { id: "linear", values: {} });
  assert.equal((await linear())?.connected, true);
  assert.equal(
    (await env.client.call("mcp.list", {})).servers.find((s) => s.name === "linear")?.transport,
    "stdio",
    "mcp-remote runs it and asks for the sign-in",
  );
  await env.client.call("integrations.disconnect", { id: "linear" });
});

test("GitHub asks its own server first: a token it refuses gets the earlier open server; unreachable keeps its own", async () => {
  const asked: Array<{ url: string; auth: string | null }> = [];
  let answer: number | "down" = 403;
  const core = await startCore({
    llm: scriptedLlm(() => say("ok")),
    integrationFetch: async (url, init) => {
      asked.push({ url: String(url), auth: new Headers(init?.headers).get("authorization") });
      if (answer === "down") throw new TypeError("fetch failed");
      return new Response("{}", { status: answer });
    },
  });
  try {
    const github = async () => (await core.client.call("mcp.list", {})).servers.find((s) => s.name === "github");
    for (const status of [403, 401] as const) {
      answer = status;
      await core.client.call("integrations.connect", { id: "github", values: { token: "ghp_example0000" } });
      assert.equal((await github())?.transport, "stdio", `${status}: the open server runs instead`);
    }
    assert.deepEqual(asked.at(-1), { url: "https://api.githubcopilot.com/mcp/", auth: "Bearer ghp_example0000" });
    assert.ok(!JSON.stringify(await core.client.call("mcp.list", {})).includes("ghp_example0000"), "never shown");

    answer = 200;
    await core.client.call("integrations.connect", { id: "github", values: { token: "" } });
    assert.equal((await github())?.transport, "http", "an edit asks again, with the stored token: now it is taken");
    assert.equal(asked.at(-1)?.auth, "Bearer ghp_example0000");

    answer = "down";
    await core.client.call("integrations.connect", { id: "github", values: { token: "ghp_example1111" } });
    assert.equal((await github())?.transport, "http", "no answer is no refusal: GitHub's own server stays");
  } finally {
    await core.core.close();
    await core.cleanup();
  }
});
