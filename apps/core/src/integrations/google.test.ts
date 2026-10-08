import assert from "node:assert/strict";
import crypto from "node:crypto";
import { test } from "node:test";
import type { Store } from "../domain/store.ts";
import type { Secrets } from "../secrets.ts";
import { flattenEvent, gaps } from "./calendar.ts";
import { bodyOf, rawMessage } from "./gmail.ts";
import { createGoogle } from "./google.ts";
import { googleAt } from "./google-oauth.ts";

const BASE = "http://google.test";
const idToken = (email: string) => `x.${Buffer.from(JSON.stringify({ email })).toString("base64url")}.y`;

/** A Google that knows one code and one refresh token, and records what it was sent. */
function fakeGoogle() {
  const seen: Array<{ url: string; form?: URLSearchParams; auth?: string }> = [];
  let minted = 0;
  let challenge = "";
  let refuseNext = false;
  let revoked = false;
  const json = (status: number, body: unknown) =>
    new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
  const fetchImpl = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    const auth = (init?.headers as Record<string, string> | undefined)?.authorization;
    if (url === `${BASE}/token`) {
      const form = new URLSearchParams(String(init?.body));
      seen.push({ url, form });
      if (form.get("client_secret") !== "s3cret") return json(401, { error: "invalid_client" });
      if (form.get("grant_type") === "authorization_code") {
        const verifier = form.get("code_verifier") ?? "";
        const hash = crypto.createHash("sha256").update(verifier).digest("base64url");
        if (form.get("code") !== "good-code" || hash !== challenge) return json(400, { error: "invalid_grant" });
        return json(200, {
          access_token: "at-0",
          refresh_token: "rt-1",
          expires_in: 3600,
          id_token: idToken("owner@example.com"),
        });
      }
      if (revoked || form.get("refresh_token") !== "rt-1")
        return json(400, { error: "invalid_grant", error_description: "Token has been expired or revoked." });
      minted += 1;
      return json(200, { access_token: `at-${minted}`, expires_in: 3600 });
    }
    seen.push({ url, ...(auth ? { auth } : {}) });
    if (refuseNext) {
      refuseNext = false;
      return json(401, { error: { message: "Invalid Credentials" } });
    }
    return json(200, { items: [] });
  }) as typeof fetch;
  return {
    fetchImpl,
    seen,
    setChallenge: (c: string) => {
      challenge = c;
    },
    refuseNext: () => {
      refuseNext = true;
    },
    revoke: () => {
      revoked = true;
    },
  };
}

function setup() {
  const settings = new Map<string, string>();
  const vault = new Map<string, string>();
  const store = {
    settings: { get: (k: string) => settings.get(k), set: (k: string, v: string) => settings.set(k, v) },
  };
  const secrets = {
    resolve: (ref?: string) => (ref?.startsWith("secret://") ? vault.get(ref.slice(9)) : undefined),
    has: (ref?: string) => Boolean(ref && vault.has(ref.slice(9))),
    set: (name: string, value: string | null) => (value === null ? vault.delete(name) : vault.set(name, value)),
  };
  let clock = Date.parse("2026-05-04T12:00:00Z");
  const fake = fakeGoogle();
  const off = new Set<string>();
  const g = createGoogle({
    store: store as unknown as Store,
    secrets: secrets as unknown as Secrets,
    endpoints: googleAt(BASE),
    origin: () => "http://127.0.0.1:7440",
    offIn: (project, id) => off.has(`${project}:${id}`),
    fetch: fake.fetchImpl,
    now: () => clock,
  });
  const start = (id: "google-calendar" | "gmail" = "google-calendar") => {
    const url = new URL(g.start(id, { client_id: "123-abc.apps.googleusercontent.com", client_secret: "s3cret" }));
    fake.setChallenge(url.searchParams.get("code_challenge") ?? "");
    return url;
  };
  return { g, fake, vault, settings, off, start, tick: (ms: number) => (clock += ms) };
}

test("the consent URL asks for a refresh token with PKCE, the integration's scopes and the panel's return page", () => {
  const { start } = setup();
  const url = start("gmail");
  const q = url.searchParams;
  assert.equal(q.get("redirect_uri"), "http://127.0.0.1:7440/oauth/google");
  assert.equal(q.get("access_type"), "offline");
  assert.equal(q.get("prompt"), "consent");
  assert.equal(q.get("code_challenge_method"), "S256");
  assert.match(q.get("scope") ?? "", /gmail\.readonly/);
  assert.doesNotMatch(q.get("scope") ?? "", /calendar/);
});

test("a sign-in finishes once, with the state this core signed; forged, altered and expired states are refused", async () => {
  const { g, start, vault, tick } = setup();
  await assert.rejects(g.finish("good-code", "forged.state"), /not valid or expired/);
  const state = start().searchParams.get("state") ?? "";
  const [body, sig] = state.split(".");
  const altered = `${Buffer.from(JSON.stringify({ id: "gmail", nonce: "x", exp: 9e15 })).toString("base64url")}.${sig}`;
  await assert.rejects(g.finish("good-code", altered), /not valid/);
  await assert.rejects(g.finish("good-code", `${body}.${sig}x`), /not valid/);

  const done = await g.finish("good-code", state);
  assert.deepEqual(done, { id: "google-calendar", account: "owner@example.com" });
  assert.equal(vault.get("google-calendar-refresh_token"), "rt-1", "the refresh token is a secret");
  assert.equal(g.connected("google-calendar"), true);
  assert.equal(g.connected("gmail"), false);
  await assert.rejects(g.finish("good-code", state), /not valid or expired/, "a state works once");

  const late = start().searchParams.get("state") ?? "";
  tick(11 * 60_000);
  await assert.rejects(g.finish("good-code", late), /expired/);
});

test("access tokens come from the refresh token when the cached one ends, and once more after a 401", async () => {
  const { g, fake, start, tick } = setup();
  await g.finish("good-code", start().searchParams.get("state") ?? "");
  await g.call("google-calendar", `${BASE}/calendar/v3/x`);
  assert.equal(fake.seen.at(-1)?.auth, "Bearer at-0", "the token from the sign-in is used first");

  tick(3600_000);
  await g.call("google-calendar", `${BASE}/calendar/v3/x`);
  assert.equal(fake.seen.at(-1)?.auth, "Bearer at-1");
  const refresh = fake.seen.find((s) => s.form?.get("grant_type") === "refresh_token");
  assert.equal(refresh?.form?.get("refresh_token"), "rt-1");

  fake.refuseNext();
  await g.call("google-calendar", `${BASE}/calendar/v3/x`);
  assert.equal(fake.seen.at(-1)?.auth, "Bearer at-2", "a refused token is minted again");

  fake.revoke();
  tick(3600_000);
  await assert.rejects(g.call("google-calendar", `${BASE}/calendar/v3/x`), /sign in again/);
});

test("an integration off in a project is not usable there; disconnecting the last one forgets the client", async () => {
  const { g, start, off, vault } = setup();
  await g.finish("good-code", start().searchParams.get("state") ?? "");
  assert.equal(g.usable("google-calendar", "p1"), true);
  off.add("p1:google-calendar");
  assert.equal(g.usable("google-calendar", "p1"), false);
  assert.equal(g.usable("google-calendar", undefined), true);
  g.disconnect("google-calendar");
  assert.equal(g.connected("google-calendar"), false);
  assert.equal(vault.size, 0, "no Google secret is left");
  assert.deepEqual(g.client(), { client_id: undefined, secret: false });
});

test("an event is flattened to what a prompt needs; free gaps fall between busy blocks", () => {
  const e = flattenEvent({
    id: "e1",
    summary: "Standup",
    start: { dateTime: "2026-05-04T09:00:00-03:00" },
    end: { dateTime: "2026-05-04T09:15:00-03:00" },
    attendees: [{ email: "ana@example.com", responseStatus: "accepted" }, {}],
    hangoutLink: "https://meet.google.com/abc",
    status: "confirmed",
  });
  assert.deepEqual(e, {
    id: "e1",
    title: "Standup",
    start: "2026-05-04T09:00:00-03:00",
    end: "2026-05-04T09:15:00-03:00",
    all_day: false,
    attendees: ["ana@example.com (accepted)"],
    meet: "https://meet.google.com/abc",
  });
  assert.equal(flattenEvent({ start: { date: "2026-05-05" } }).all_day, true);
  const at = (h: number) => Date.parse(`2026-05-04T${String(h).padStart(2, "0")}:00:00Z`);
  const free = gaps({ from: "2026-05-04T09:00:00Z", to: "2026-05-04T17:00:00Z", minutes: 60, limit: 5 }, [
    [at(9), at(10)],
    [at(10), at(12)],
    [at(13), at(16)],
  ]);
  assert.deepEqual(free, [
    { start: "2026-05-04T12:00:00.000Z", end: "2026-05-04T13:00:00.000Z" },
    { start: "2026-05-04T16:00:00.000Z", end: "2026-05-04T17:00:00.000Z" },
  ]);
});

test("a mail body is its plain part, else its HTML as text; a draft is a UTF-8 message", () => {
  const b64 = (s: string) => Buffer.from(s).toString("base64url");
  const mixed = {
    mimeType: "multipart/mixed",
    parts: [
      { mimeType: "text/html", body: { data: b64("<p>Hola <b>Ana</b></p>") } },
      { mimeType: "application/pdf", filename: "invoice.pdf", body: { size: 10 } },
    ],
  };
  assert.deepEqual(bodyOf(mixed), { text: "Hola Ana", attachments: ["invoice.pdf"] });
  const raw = Buffer.from(
    rawMessage({ to: ["ana@example.com"], subject: "Reunión", body: "Nos vemos", inReplyTo: "<m1@example.com>" }),
    "base64url",
  ).toString("utf8");
  assert.match(raw, /^To: ana@example\.com\r\n/);
  assert.match(raw, /Subject: =\?UTF-8\?B\?/);
  assert.match(raw, /In-Reply-To: <m1@example\.com>/);
  assert.ok(raw.includes(Buffer.from("Nos vemos").toString("base64")));
  // A reply's headers come from someone else's mail: a line break there cannot add a header.
  const forged = Buffer.from(
    rawMessage({
      to: ["ana@example.com"],
      subject: "Hi",
      body: "x",
      inReplyTo: "<a@example.com>\r\nBcc: x@example.com",
    }),
    "base64url",
  ).toString("utf8");
  assert.doesNotMatch(forged, /\r\nBcc:/);
});
