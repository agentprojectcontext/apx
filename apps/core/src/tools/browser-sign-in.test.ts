// Signing in with a stored secret through a fake desktop node: the value reaches the browser and nothing else — not
// the tool's result, the model, the run's steps or anything the core keeps on disk (DECISIONS.md#d-193).
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { after, before, test } from "node:test";
import { type BrowserFillSecret, SCOPE_METHODS, siteAllowed } from "@apx/protocol";
import { ApxClient, type ApxSocket } from "@apx/protocol/client";
import { callTool, say, scriptedLlm, startCore } from "../engine/testkit.ts";
import { waitFor } from "../testkit/platform.ts";
import { totp } from "../totp.ts";

const PASSWORD = "Northwind-hunter2-correct";
const SEED = "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ";

const llm = scriptedLlm((req, { said, afterTool }) => {
  if (afterTool) return say(`Done: ${String(req.messages.findLast((m) => m.role === "tool")?.content)}`);
  const m = /^sign in with (\w+) as (\w+)/.exec(said);
  if (m) return callTool("s1", "browser_sign_in", { tab: "t1", ref: "e2", secret: m[1], kind: m[2] });
  return say("ok");
});

let env: Awaited<ReturnType<typeof startCore>>;
let desktop: ApxSocket;
const fills: BrowserFillSecret[] = [];
let url = "https://app.acme.com/login";

before(async () => {
  env = await startCore({ llm });
  desktop = await new ApxClient({ url: env.core.url }).connect("node", ["browser"]);
  desktop.onRequest(async (method, params) => {
    if (method === "browser.tabs")
      return { tabs: [{ tab: "t1", url, title: "Sign in", profile: "shared", control: { kind: "idle" } }] };
    if (method === "browser.hold") return { ok: true };
    if (method === "browser.fill_secret") {
      const p = params as BrowserFillSecret;
      fills.push(p);
      const origin = new URL(url).origin;
      // The browser's own check at fill time, as CdpPage makes it.
      return siteAllowed(p.origins, origin)
        ? { outcome: "filled", origin }
        : { outcome: "refused", origin, reason: "not a site this secret is for" };
    }
    throw new Error(`unknown ${method}`);
  });
  await env.client.call("secrets.set", { name: "ACME_PASSWORD", value: PASSWORD });
  await env.client.call("secrets.set", { name: "ACME_TOTP", value: SEED });
});
after(async () => {
  desktop.close();
  await env.core.close();
  await env.cleanup();
});

/** Every file the core keeps, except the test's file store of secret values, holds none of these. */
function assertNowhere(...values: string[]) {
  const files: string[] = [];
  const walk = (dir: string) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const at = path.join(dir, e.name);
      if (e.isDirectory()) walk(at);
      else if (e.name !== "secrets.json") files.push(at);
    }
  };
  walk(env.home);
  for (const v of values) {
    for (const f of files) assert.ok(!fs.readFileSync(f).includes(v), `${path.basename(f)} holds a secret's value`);
    assert.ok(!JSON.stringify(llm.calls).includes(v), "a model call carried a secret's value");
  }
}

async function ask(text: string) {
  const thread = (await env.client.call("threads.create", { kind: "loose", agent_id: "superagent" })).id;
  await env.client.call("threads.send", { thread, text });
  return thread;
}

const answer = async (thread: string) => {
  const messages = (await env.client.call("threads.get", { thread })).messages;
  return messages
    .flatMap((m) => m.parts)
    .map((p) => (p.type === "text" ? p.text : ""))
    .join("\n");
};

test("on a site the owner marked, the password goes to the browser only; the agent gets 'filled'", async () => {
  await env.client.call("secrets.set_sites", {
    name: "ACME_PASSWORD",
    sites: [{ origin: "https://app.acme.com", kind: "password" }],
  });
  const thread = await ask("sign in with ACME_PASSWORD as password");
  await env.settle(thread);
  assert.match(await answer(thread), /filled e2 on https:\/\/app\.acme\.com with ACME_PASSWORD/);
  assert.equal(fills.at(-1)?.value, PASSWORD);
  assert.deepEqual(fills.at(-1)?.origins, ["https://app.acme.com"]);
  const listed = (await env.client.call("secrets.list", {})).secrets.find((s) => s.name === "ACME_PASSWORD");
  assert.equal(listed?.last_used?.origin, "https://app.acme.com");
  assertNowhere(PASSWORD);
});

test("a one-time code secret fills the current code; the seed never leaves the core", async () => {
  await env.client.call("secrets.set_sites", {
    name: "ACME_TOTP",
    sites: [{ origin: "https://app.acme.com", kind: "otp" }],
  });
  const thread = await ask("sign in with ACME_TOTP as otp");
  await env.settle(thread);
  const code = fills.at(-1)?.value ?? "";
  assert.match(code, /^\d{6}$/);
  assert.ok([0, -30_000].some((d) => totp(SEED, Date.now() + d) === code));
  assertNowhere(SEED, PASSWORD);
});

test("on a site nobody marked, the owner is asked in the app: once covers one fill, always marks the site", async () => {
  url = "https://partner.acme.com/login";
  try {
    const before = fills.length;
    const t1 = await ask("sign in with ACME_PASSWORD as password");
    const card = await waitFor(async () => (await env.client.call("runs.pending", { thread: t1 })).inputs[0]);
    assert.equal(env.core.store.inputs.get(card.id)?.app_only, true);
    assert.match(card.prompt ?? "", /ACME_PASSWORD/);
    assert.match(card.prompt ?? "", /https:\/\/partner\.acme\.com/);
    assert.equal(fills.length, before, "nothing reaches the browser before the owner answers");
    await env.client.call("runs.respond", { input: card.id, text: "Una vez" });
    await env.settle(t1);
    assert.equal(fills.length, before + 1);
    assert.deepEqual(fills.at(-1)?.origins, ["https://app.acme.com", "https://partner.acme.com"]);

    // The "Once" is spent: the next turn asks again; this time the owner says no.
    const t2 = await ask("sign in with ACME_PASSWORD as password");
    const again = await waitFor(async () => (await env.client.call("runs.pending", { thread: t2 })).inputs[0]);
    await env.client.call("runs.respond", { input: again.id, text: "No" });
    await env.settle(t2);
    assert.equal(fills.length, before + 1);
    assert.match(await answer(t2), /refused: the owner did not allow/);

    const t3 = await ask("sign in with ACME_PASSWORD as password");
    const always = await waitFor(async () => (await env.client.call("runs.pending", { thread: t3 })).inputs[0]);
    await env.client.call("runs.respond", { input: always.id, text: "Siempre en este sitio" });
    await env.settle(t3);
    const sites = (await env.client.call("secrets.list", {})).secrets.find((s) => s.name === "ACME_PASSWORD")?.sites;
    assert.deepEqual(sites, [
      { origin: "https://app.acme.com", kind: "password" },
      { origin: "https://partner.acme.com", kind: "password" },
    ]);
  } finally {
    url = "https://app.acme.com/login";
  }
  assertNowhere(PASSWORD);
});

test("a secret marked for passwords never goes into another kind of field, and nobody is asked", async () => {
  const before = fills.length;
  const thread = await ask("sign in with ACME_PASSWORD as username");
  await env.settle(thread);
  assert.match(await answer(thread), /refused: ACME_PASSWORD is for a password field, not username/);
  assert.equal(fills.length, before);
  assert.equal((await env.client.call("runs.pending", { thread })).inputs.length, 0);
});

test("only APX's own agents in a turn may sign in: not outside apps, not a client acting as an agent", async () => {
  assert.ok(!SCOPE_METHODS.browser.includes("browser.sign_in"));
  const agent = new ApxClient({ url: env.core.url, actor: "agent" });
  await assert.rejects(
    agent.call("browser.sign_in", { tab: "t1", ref: "e2", secret: "ACME_PASSWORD", kind: "password" }),
    /own agents/,
  );
});

test("the owner marks exact sites or every site; a new value keeps them, and removing the secret removes them", async () => {
  await assert.rejects(
    env.client.call("secrets.set_sites", {
      name: "ACME_PASSWORD",
      sites: [{ origin: "https://app.acme.com/login", kind: "password" }],
    }),
    /not a site's address/,
  );
  await assert.rejects(
    env.client.call("secrets.set_sites", { name: "NOBODY", sites: [{ origin: "*", kind: "password" }] }),
    /not found/,
  );
  const r = await env.client.call("secrets.set_sites", {
    name: "ACME_PASSWORD",
    sites: [
      { origin: "*", kind: "password" },
      { origin: "https://app.acme.com/", kind: "password" },
    ],
  });
  assert.deepEqual(r.sites, [
    { origin: "*", kind: "password" },
    { origin: "https://app.acme.com", kind: "password" },
  ]);
  await env.client.call("secrets.set", { name: "ACME_PASSWORD", value: `${PASSWORD}-2` });
  const kept = (await env.client.call("secrets.list", {})).secrets.find((s) => s.name === "ACME_PASSWORD");
  assert.equal(kept?.sites.length, 2);
  await env.client.call("secrets.set", { name: "ACME_PASSWORD", value: null });
  await env.client.call("secrets.set", { name: "ACME_PASSWORD", value: PASSWORD });
  const fresh = (await env.client.call("secrets.list", {})).secrets.find((s) => s.name === "ACME_PASSWORD");
  assert.deepEqual(fresh?.sites, []);
});
