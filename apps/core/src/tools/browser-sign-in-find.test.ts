// browser_sign_in without a name: APX finds the owner's sign-in for the site, asks which one, or has the owner type
// one on a card, to use once or save (DECISIONS.md#d-264). The values reach the browser and nothing else.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { after, before, test } from "node:test";
import { type BrowserFillSecret, type Part, siteAllowed } from "@apx/protocol";
import { ApxClient, type ApxSocket } from "@apx/protocol/client";
import { callTool, say, scriptedLlm, startCore } from "../engine/testkit.ts";
import { loginName, siteWords } from "../sign-in.ts";
import { filesUnder, waitFor } from "../testkit/platform.ts";

const USER = "pat.northwind@example.com";
const PASSWORD = "Northwind-hunter2-correct";
const TYPED_USER = "lee@example.com";
const TYPED_PASSWORD = "Globex-typed-once-9931";

const llm = scriptedLlm((req, { said, afterTool }) => {
  if (afterTool) return say(`Done: ${String(req.messages.findLast((m) => m.role === "tool")?.content)}`);
  const m = /^sign in as (\w+)/.exec(said);
  if (m) return callTool("s1", "browser_sign_in", { tab: "t1", ref: m[1] === "username" ? "e2" : "e3", kind: m[1] });
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
      return siteAllowed(p.origins, origin)
        ? { outcome: "filled", origin }
        : { outcome: "refused", origin, reason: "not a site this secret is for" };
    }
    throw new Error(`unknown ${method}`);
  });
});
after(async () => {
  desktop.close();
  await env.core.close();
  await env.cleanup();
});

/** Every file the core keeps, except the test's file store of secret values, holds none of these. */
function assertNowhere(...values: string[]) {
  const files = filesUnder(env.home).filter((f) => path.basename(f) !== "secrets.json");
  for (const v of values) {
    for (const f of files) assert.ok(!fs.readFileSync(f).includes(v), `${path.basename(f)} holds a secret's value`);
    assert.ok(!JSON.stringify(llm.calls).includes(v), "a model call carried a secret's value");
  }
}

const newThread = async () => (await env.client.call("threads.create", { kind: "loose", agent_id: "superagent" })).id;
const say_ = (thread: string, text: string) => env.client.call("threads.send", { thread, text });
const answer = async (thread: string) =>
  (await env.client.call("threads.get", { thread })).messages
    .flatMap((m) => m.parts)
    .map((p) => (p.type === "text" ? p.text : ""))
    .join("\n");
const card = (thread: string) => waitFor(async () => (await env.client.call("runs.pending", { thread })).inputs[0]);
/** The card as the chat shows it. */
const cardPart = async (thread: string, id: string) =>
  (await env.client.call("threads.get", { thread })).messages
    .flatMap((m) => m.parts)
    .find((p): p is Extract<Part, { type: "input" }> => p.type === "input" && p.input_id === id);
const sites = async (name: string) =>
  (await env.client.call("secrets.list", {})).secrets.find((s) => s.name === name)?.sites ?? [];

test("a sign-in variable keeps a username and a password: each goes into its own field, the reveal shows both", async () => {
  await env.client.call("secrets.set", { name: "ACME_LOGIN", login: { username: USER, password: PASSWORD } });
  const listed = (await env.client.call("secrets.list", {})).secrets.find((s) => s.name === "ACME_LOGIN");
  assert.equal(listed?.field, "login");
  assert.equal(listed?.hint, undefined, "no part of a sign-in is shown as a hint");
  assert.deepEqual(await env.client.call("secrets.reveal", { name: "ACME_LOGIN" }), {
    value: PASSWORD,
    username: USER,
  });
  // Marked by the owner for one field, it is marked for both.
  await env.client.call("secrets.set_sites", {
    name: "ACME_LOGIN",
    sites: [{ origin: "https://app.acme.com", kind: "password" }],
  });
  assert.deepEqual(await sites("ACME_LOGIN"), [
    { origin: "https://app.acme.com", kind: "username" },
    { origin: "https://app.acme.com", kind: "password" },
  ]);
  // A new password keeps the username.
  await env.client.call("secrets.set", { name: "ACME_LOGIN", login: { password: `${PASSWORD}-2` } });
  assert.equal((await env.client.call("secrets.reveal", { name: "ACME_LOGIN" })).username, USER);
  await env.client.call("secrets.set", { name: "ACME_LOGIN", login: { password: PASSWORD } });
});

test("on a site with one sign-in set for it, both fields fill without asking anyone", async () => {
  const thread = await newThread();
  const before = fills.length;
  await say_(thread, "sign in as username");
  await env.settle(thread);
  await say_(thread, "sign in as password");
  await env.settle(thread);
  assert.equal((await env.client.call("runs.pending", { thread })).inputs.length, 0);
  assert.deepEqual(
    fills.slice(before).map((f) => [f.kind, f.value]),
    [
      ["username", USER],
      ["password", PASSWORD],
    ],
  );
  assert.match(await answer(thread), /filled e3 on https:\/\/app\.acme\.com with ACME_LOGIN/);
  assertNowhere(PASSWORD, USER);
});

test("a sign-in named after the site is offered on a card; yes uses it and sets it for the site", async () => {
  url = "https://accounts.northwind.example/login";
  try {
    await env.client.call("secrets.set", {
      name: "NORTHWIND_LOGIN",
      login: { username: USER, password: PASSWORD },
    });
    // A plain variable whose name does not say it signs in is never offered.
    await env.client.call("secrets.set", { name: "NORTHWIND_API_KEY", value: "nw-key-0000000000" });
    const thread = await newThread();
    const before = fills.length;
    await say_(thread, "sign in as username");
    const asked = await card(thread);
    assert.equal(env.core.store.inputs.get(asked.id)?.app_only, true);
    assert.match(asked.prompt, /accounts\.northwind\.example.*NORTHWIND_LOGIN/);
    assert.ok(!asked.options?.some((o) => o.includes("API_KEY")));
    assert.equal(fills.length, before, "nothing reaches the browser before the owner answers");
    await env.client.call("runs.respond", { input: asked.id, text: "Sí" });
    await env.settle(thread);
    assert.equal(fills.at(-1)?.value, USER);
    assert.deepEqual(await sites("NORTHWIND_LOGIN"), [
      { origin: "https://accounts.northwind.example", kind: "username" },
      { origin: "https://accounts.northwind.example", kind: "password" },
    ]);
    // Now it is the site's: the password goes in without a card.
    await say_(thread, "sign in as password");
    await env.settle(thread);
    assert.equal(fills.at(-1)?.value, PASSWORD);
    assert.equal((await env.client.call("runs.pending", { thread })).inputs.length, 0);
  } finally {
    url = "https://app.acme.com/login";
  }
});

test("with nothing for the site, the owner types a sign-in on a card and saves it under a name of its own", async () => {
  url = "https://app.globex.example/session";
  try {
    // The name it would get is taken (by a code seed, which no username field is offered): the saved one gets the next.
    const taken = loginName("https://app.globex.example", TYPED_USER);
    assert.equal(taken, "GLOBEX_LEE_LOGIN");
    await env.client.call("secrets.set", { name: taken, value: "GEZDGNBVGY3TQOJQGEZDGNBV", field: "otp" });
    const thread = await newThread();
    await say_(thread, "sign in as username");
    const asked = await card(thread);
    const part = await cardPart(thread, asked.id);
    assert.deepEqual(part?.login, { origin: "https://app.globex.example", kind: "username" });
    // A channel or an agent never answers it, and the generic answer carries no values.
    await assert.rejects(
      new ApxClient({ url: env.core.url, actor: "agent" }).call("secrets.provide_login", {
        input: asked.id,
        username: TYPED_USER,
        password: TYPED_PASSWORD,
        save: true,
      }),
    );
    await assert.rejects(
      env.client.call("secrets.provide_login", { input: asked.id, username: "", password: TYPED_PASSWORD, save: true }),
      /asks for the username/,
    );
    const r = await env.client.call("secrets.provide_login", {
      input: asked.id,
      username: TYPED_USER,
      password: TYPED_PASSWORD,
      save: true,
    });
    assert.equal(r.name, `${taken}_2`);
    await env.settle(thread);
    assert.equal(fills.at(-1)?.value, TYPED_USER);
    assert.equal(env.core.store.inputs.get(asked.id)?.answer, `Guardado como ${taken}_2`);
    assert.match(await answer(thread), /GLOBEX_LEE_LOGIN_2, which the owner just saved/);
    await say_(thread, "sign in as password");
    await env.settle(thread);
    assert.equal(fills.at(-1)?.value, TYPED_PASSWORD);
    assertNowhere(TYPED_PASSWORD, TYPED_USER);
  } finally {
    url = "https://app.acme.com/login";
  }
});

test("a sign-in typed for one use fills each field once in that chat and is never stored", async () => {
  url = "https://portal.initech.example/";
  const pass = "Initech-only-this-time-77";
  try {
    const names = async () => (await env.client.call("secrets.list", {})).secrets.map((s) => s.name);
    const known = await names();
    const thread = await newThread();
    await say_(thread, "sign in as password");
    const asked = await card(thread);
    await env.client.call("secrets.provide_login", { input: asked.id, username: "", password: pass, save: false });
    await env.settle(thread);
    assert.equal(fills.at(-1)?.value, pass);
    assert.match(await answer(thread), /the sign-in the owner typed for this time/);
    assert.deepEqual(await names(), known, "nothing was saved");
    // Used up: the next sign-in asks again.
    await say_(thread, "sign in as password");
    const again = await card(thread);
    await env.client.call("runs.respond", { input: again.id, text: "No" });
    await env.settle(thread);
    assertNowhere(pass);
  } finally {
    url = "https://app.acme.com/login";
  }
});

test("a site's words skip what every address has", () => {
  assert.deepEqual(siteWords("https://accounts.google.com"), ["google"]);
  assert.deepEqual(siteWords("https://www.acme.co.uk"), ["acme"]);
  assert.equal(loginName("https://www.acme.co.uk", ""), "ACME_LOGIN");
});
