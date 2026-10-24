import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";
import { callTool, say, scriptedLlm, startCore } from "../engine/testkit.ts";
import { removeDir, waitFor } from "../testkit/platform.ts";
import { signInUrl } from "./sign-in.ts";

const SERVER = path.join(import.meta.dirname, "fake-sign-in-server.test-support.mjs");

const llm = scriptedLlm((req, { said, afterTool }) => {
  if (afterTool) return say(`Result: ${String(req.messages.at(-1)?.content).slice(0, 300)}`);
  if (said.includes("find echo")) return callTool("s1", "mcp_search", { query: "echo text" });
  if (said.includes("use echo")) return callTool("e1", "mcp_call", { tool: "mcp_shop_echo", args: { text: "hi" } });
  return say("ok");
});

let env: Awaited<ReturnType<typeof startCore>>;
let dir = "";
before(async () => {
  env = await startCore({ llm });
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "apx-sign-in-"));
});
after(async () => {
  await env.core.close();
  await env.cleanup();
  await removeDir(dir);
});

/** One of the owner's servers that signs in like mcp-remote; `opened()` counts the browsers it would have opened. */
async function addServer(name: string, extra: Record<string, string> = {}) {
  const signed = path.join(dir, `${name}.signed`);
  const log = path.join(dir, `${name}.opened`);
  const server = {
    command: process.execPath,
    args: [SERVER],
    env: { SIGNED_FILE: signed, OPENED_LOG: log, ...extra },
  };
  await env.client.call("mcp.set", { name, server });
  return {
    server,
    signIn: () => fs.writeFileSync(signed, "ok"),
    opened: () => (fs.existsSync(log) ? fs.readFileSync(log, "utf8").split("\n").filter(Boolean).length : 0),
    running: () => {
      try {
        process.kill(Number(fs.readFileSync(`${log}.pid`, "utf8")), 0);
        return true;
      } catch {
        return false;
      }
    },
  };
}

const turn = async (text: string) => {
  const t = await env.client.call("threads.create", { kind: "loose", agent_id: "roby" });
  await env.client.call("threads.send", { thread: t.id, text });
  await env.settle(t.id, 15_000);
  return String(llm.calls.at(-1)?.messages.at(-1)?.content);
};
const statusOf = async (name: string) => (await env.client.call("mcp.list", {})).servers.find((s) => s.name === name);
/** The server once it has `status`. */
const becomes = (name: string, status: string) =>
  waitFor(
    async () => {
      const s = await statusOf(name);
      return s?.status === status && s;
    },
    `${name} to become ${status}`,
    { ms: 10_000 },
  );

test("a sign-in request on stderr is found with its page, and only once the URL is whole", () => {
  const url = "https://admin.example.com/authorize?response_type=code&client_id=abc";
  assert.equal(signInUrl(`\nPlease authorize this client by visiting:\n${url}\n`), url);
  assert.equal(signInUrl(`Sign in at ${url} to continue\n`), url);
  // Cut mid-chunk: the rest may still come.
  assert.equal(signInUrl(`Please authorize this client by visiting:\n${url.slice(0, 30)}`), undefined);
  assert.equal(signInUrl("Server listening on https://localhost:3000 \n"), undefined);
});

test("a server that asks to sign in does not hold the turn, is not retried, and the sign-in can still finish", async () => {
  const shop = await addServer("shop");
  const t0 = Date.now();
  await turn("find echo");
  // The turn goes on at once, not after the start deadline.
  assert.ok(Date.now() - t0 < 10_000, `turn took ${Date.now() - t0} ms`);
  const waiting = await statusOf("shop");
  assert.equal(waiting?.status, "needs-sign-in");
  assert.equal(waiting?.sign_in_url, "https://shop.example.com/authorize?state=1");

  // More turns do not start it again: every start would open the owner's browser once more.
  await turn("find echo");
  assert.equal(shop.opened(), 1);

  // The owner finishes on the page the first start opened: that same process becomes the connection.
  shop.signIn();
  await becomes("shop", "ready");
  assert.match(await turn("use echo"), /echo: hi/);
  assert.equal(shop.opened(), 1);
});

test("waiting for a sign-in outlives the connection, and only the owner's Sign in starts it again", async () => {
  const shop = await addServer("store");
  await turn("find echo");
  await becomes("store", "needs-sign-in");
  assert.equal(shop.opened(), 1);

  // The same definition again drops the live connection, as a restart does: it still waits on the owner, and the
  // process left waiting on its page is ended, not kept for minutes.
  assert.equal(shop.running(), true);
  await env.client.call("mcp.set", { name: "store", server: shop.server });
  await waitFor(() => !shop.running(), "the shop server stopped");
  assert.equal(shop.running(), false);
  await turn("find echo");
  const after = await statusOf("store");
  assert.equal(after?.status, "needs-sign-in");
  assert.equal(after?.sign_in_url, undefined);
  const tested = await env.client.call("mcp.test", { scope: "global", server: "store" });
  assert.equal(tested.ok, false);
  assert.match(tested.error ?? "", /sign in/);
  assert.equal(shop.opened(), 1);

  const { server } = await env.client.call("mcp.signIn", { scope: "global", server: "store" });
  assert.equal(server.status, "needs-sign-in");
  assert.ok(server.sign_in_url);
  assert.equal(shop.opened(), 2);
  shop.signIn();
  await becomes("store", "ready");
});

test("a test that runs into a sign-in hands its copy to agents instead of closing it", async () => {
  const shop = await addServer("market");
  const tested = await env.client.call("mcp.test", { scope: "global", server: "market" });
  assert.equal(tested.ok, false);
  assert.match(tested.error ?? "", /asked you to sign in/);
  assert.equal((await statusOf("market"))?.status, "needs-sign-in");
  shop.signIn();
  await becomes("market", "ready");
  assert.equal(shop.opened(), 1);
});

test("a sign-in that ends unfinished keeps waiting on the owner, without a page to finish on", async () => {
  const shop = await addServer("bazaar", { GIVE_UP: "1" });
  await turn("find echo");
  for (let i = 0; i < 100 && (await statusOf("bazaar"))?.error === undefined; i++)
    await new Promise((r) => setTimeout(r, 50));
  const s = await statusOf("bazaar");
  assert.equal(s?.status, "needs-sign-in");
  assert.equal(s?.sign_in_url, undefined);
  await turn("find echo");
  assert.equal(shop.opened(), 1);
});
