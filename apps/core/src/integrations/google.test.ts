import assert from "node:assert/strict";
import crypto from "node:crypto";
import { test } from "node:test";
import type { Store } from "../domain/store.ts";
import type { Secrets } from "../secrets.ts";
import { calendarApi, flattenEvent, gaps } from "./calendar.ts";
import { driveApi, driveQuery } from "./drive.ts";
import { bodyOf, gmailApi, rawMessage } from "./gmail.ts";
import { createGoogle } from "./google.ts";
import { googleAt } from "./google-oauth.ts";

const BASE = "http://google.test";
const idToken = (email: string) => `x.${Buffer.from(JSON.stringify({ email })).toString("base64url")}.y`;

/** A Google that knows one code and one refresh token, and records what it was sent. */
function fakeGoogle() {
  const seen: Array<{ url: string; form?: URLSearchParams; auth?: string; method?: string; body?: unknown }> = [];
  let minted = 0;
  let challenge = "";
  let refuseNext = false;
  let revoked = false;
  let respond: ((url: URL, init?: RequestInit) => unknown) | undefined;
  const json = (status: number, body: unknown) =>
    new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
  const fetchImpl = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    const auth = (init?.headers as Record<string, string> | undefined)?.authorization;
    if (url === `${BASE}/token`) {
      const form = new URLSearchParams(String(init?.body));
      seen.push({ url, form });
      if (!["s3cret", "apx-public"].includes(form.get("client_secret") ?? ""))
        return json(401, { error: "invalid_client" });
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
    seen.push({
      url,
      ...(auth ? { auth } : {}),
      method: init?.method,
      ...(init?.body ? { body: parsed(String(init.body)) } : {}),
    });
    if (refuseNext) {
      refuseNext = false;
      return json(401, { error: { message: "Invalid Credentials" } });
    }
    const answer = respond?.(new URL(url), init) ?? { items: [] };
    return answer instanceof Response ? answer : json(200, answer);
  }) as typeof fetch;
  return {
    fetchImpl,
    seen,
    respond: (fn: (url: URL, init?: RequestInit) => unknown) => {
      respond = fn;
    },
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

/** A JSON body as data, anything else (an upload) as its text. */
const parsed = (body: string): unknown => {
  try {
    return JSON.parse(body) as unknown;
  } catch {
    return body;
  }
};

function setup(o: { builtin?: boolean } = {}) {
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
    ...(o.builtin ? { builtin: { clientId: "apx.apps.googleusercontent.com", clientSecret: "apx-public" } } : {}),
  });
  const start = (id: "google-calendar" | "gmail" | "google-drive" = "google-calendar") => {
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
  assert.deepEqual(done, { id: "google-calendar", also: [], account: "owner@example.com" });
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
  assert.deepEqual(g.client(), { client_id: undefined, secret: false, builtin: false });
});

test("with APX's own client the owner signs in without one, and each integration keeps the client it signed in with", async () => {
  const { g, fake, vault, settings, tick } = setup({ builtin: true });
  assert.equal(g.client().builtin, true);
  const url = new URL(g.start("google-calendar", {}));
  assert.equal(url.searchParams.get("client_id"), "apx.apps.googleusercontent.com", "nothing typed: APX's client");
  // APX's client asks for no restricted scope: Google verifies it without a security assessment.
  const apxGmail = new URL(g.start("gmail", {})).searchParams.get("scope") ?? "";
  assert.match(apxGmail, /gmail\.send/);
  assert.doesNotMatch(apxGmail, /gmail\.(readonly|compose)/);
  const apxDrive = new URL(g.start("google-drive", {})).searchParams.get("scope") ?? "";
  assert.match(apxDrive, /drive\.file/);
  assert.doesNotMatch(apxDrive, /drive\.readonly/);
  fake.setChallenge(url.searchParams.get("code_challenge") ?? "");
  await g.finish("good-code", url.searchParams.get("state") ?? "");
  assert.equal(g.clientOf("google-calendar"), "apx");
  assert.equal(settings.get("google_client_id"), undefined, "APX's client is never stored as the owner's");
  assert.equal(vault.has("google-client_secret"), false);

  // Gmail on the owner's own client, beside Calendar on APX's.
  const own = new URL(
    g.start("gmail", { client: "own", client_id: "123-abc.apps.googleusercontent.com", client_secret: "s3cret" }),
  );
  assert.equal(own.searchParams.get("client_id"), "123-abc.apps.googleusercontent.com");
  fake.setChallenge(own.searchParams.get("code_challenge") ?? "");
  await g.finish("good-code", own.searchParams.get("state") ?? "");
  assert.equal(g.clientOf("gmail"), "own");
  assert.match(own.searchParams.get("scope") ?? "", /gmail\.readonly/, "the owner's client gets every scope");
  assert.equal(g.full("gmail"), true);
  assert.equal(g.full("google-calendar"), false);

  tick(3600_000);
  await g.call("google-calendar", `${BASE}/calendar/v3/x`);
  await g.call("gmail", `${BASE}/gmail/v1/x`);
  const refreshes = fake.seen.filter((s) => s.form?.get("grant_type") === "refresh_token");
  assert.deepEqual(
    refreshes.map((s) => s.form?.get("client_id")),
    ["apx.apps.googleusercontent.com", "123-abc.apps.googleusercontent.com"],
    "a refresh token goes to the client that issued it",
  );

  g.disconnect("google-calendar");
  assert.equal(g.client().client_id, "123-abc.apps.googleusercontent.com", "Gmail still signs in with it");
  g.disconnect("gmail");
  assert.equal(g.client().client_id, undefined);
});

test("one sign-in connects several Google parts: their scopes in one consent, the refresh token kept for each", async () => {
  const { g, fake, vault } = setup();
  const url = new URL(
    g.start("gmail", { client: "own", client_id: "123-abc.apps.googleusercontent.com", client_secret: "s3cret" }, [
      "google-drive",
      "google-calendar",
      "gmail",
    ]),
  );
  const scope = url.searchParams.get("scope") ?? "";
  for (const s of ["gmail.readonly", "drive.readonly", "calendar.events"]) assert.match(scope, new RegExp(s));
  fake.setChallenge(url.searchParams.get("code_challenge") ?? "");
  const done = await g.finish("good-code", url.searchParams.get("state") ?? "");
  assert.deepEqual(done.also, ["google-drive", "google-calendar"], "the part asked for is not repeated");
  for (const id of ["gmail", "google-drive", "google-calendar"] as const) {
    assert.equal(g.connected(id), true);
    assert.equal(g.clientOf(id), "own");
    assert.equal(vault.get(`${id}-refresh_token`), "rt-1");
  }
  g.disconnect("gmail");
  assert.equal(g.connected("google-drive"), true, "each part disconnects on its own");
  assert.equal(g.client().client_id, "123-abc.apps.googleusercontent.com", "Drive still uses the owner's client");
});

test("without a client of APX's own, a sign-in with nothing typed says to bring one", () => {
  const { g } = setup();
  assert.throws(() => g.start("google-calendar", {}), /client id and the client secret/);
  assert.throws(() => g.start("google-calendar", { client: "apx" }), /no Google client of its own/);
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

test("free-time search clips busy intervals to the requested range before enforcing duration", () => {
  const at = (h: number) => Date.parse(`2026-05-04T${String(h).padStart(2, "0")}:00:00Z`);
  const options = { from: "2026-05-04T09:00:00Z", to: "2026-05-04T17:00:00Z", minutes: 60, limit: 5 };
  assert.deepEqual(
    gaps(options, [
      [at(18), at(19)],
      [at(20), at(21)],
    ]),
    [{ start: "2026-05-04T09:00:00.000Z", end: "2026-05-04T17:00:00.000Z" }],
  );
  assert.deepEqual(gaps({ ...options, to: "2026-05-04T09:30:00Z" }, [[at(11), at(12)]]), []);
  assert.deepEqual(
    gaps(options, [
      [at(7), at(10)],
      [at(16), at(20)],
    ]),
    [{ start: "2026-05-04T10:00:00.000Z", end: "2026-05-04T16:00:00.000Z" }],
  );
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

test("Calendar create and update preserve date kinds, invitations, meeting requests and explicit field clearing", async () => {
  const { g, start, fake } = setup();
  await g.finish("good-code", start().searchParams.get("state") ?? "");
  fake.respond((_url, init) => ({ id: "event/1", ...JSON.parse(String(init?.body)) }));
  const api = calendarApi(g);
  const result = await api.create({
    calendar: "team@example.com",
    title: "Planning",
    start: "2026-05-04T10:00:00Z",
    end: "2026-05-04T11:00:00Z",
    time_zone: "UTC",
    attendees: ["user@example.com"],
    meet: true,
    location: "Office",
    description: "Agenda",
  });
  assert.equal(result.title, "Planning");
  assert.equal(result.all_day, false);
  const made = fake.seen.at(-1);
  assert.equal(made?.method, "POST");
  const url = new URL(made?.url ?? "");
  assert.equal(url.pathname, "/calendar/v3/calendars/team%40example.com/events");
  assert.equal(url.searchParams.get("sendUpdates"), "all");
  assert.equal(url.searchParams.get("conferenceDataVersion"), "1");
  const body = made?.body as {
    start: unknown;
    end: unknown;
    attendees: unknown;
    conferenceData: { createRequest: { requestId: string; conferenceSolutionKey: unknown } };
  };
  assert.deepEqual(body.start, { dateTime: "2026-05-04T10:00:00Z", timeZone: "UTC" });
  assert.deepEqual(body.attendees, [{ email: "user@example.com" }]);
  assert.match(body.conferenceData.createRequest.requestId, /^[\da-f-]{36}$/);
  assert.deepEqual(body.conferenceData.createRequest.conferenceSolutionKey, { type: "hangoutsMeet" });
  await api.create({ calendar: "primary", title: "Day off", start: "2026-05-05", end: "2026-05-06" });
  assert.deepEqual(fake.seen.at(-1)?.body, {
    summary: "Day off",
    start: { date: "2026-05-05" },
    end: { date: "2026-05-06" },
  });
  await api.update({
    calendar: "primary",
    id: "event/1",
    title: "",
    description: "",
    location: "",
    attendees: [],
    start: "2026-05-05",
  });
  const changed = fake.seen.at(-1);
  assert.equal(changed?.method, "PATCH");
  assert.ok(changed?.url.endsWith("/event%2F1?sendUpdates=all"));
  assert.deepEqual(changed?.body, {
    summary: "",
    description: "",
    location: "",
    attendees: [],
    start: { date: "2026-05-05" },
  });
});

test("Calendar free-time normalizes unsorted invalid busy data and respects minimum duration and result limit", async () => {
  const { g, start, fake } = setup();
  await g.finish("good-code", start().searchParams.get("state") ?? "");
  fake.respond(() => ({
    calendars: {
      primary: {
        busy: [
          { start: "2026-05-04T13:00:00Z", end: "2026-05-04T14:00:00Z" },
          { start: "invalid", end: "invalid" },
          { start: "2026-05-04T10:00:00Z", end: "2026-05-04T11:00:00Z" },
        ],
      },
      other: {},
    },
  }));
  const result = await calendarApi(g).free({
    calendar: "primary",
    from: "2026-05-04T09:00:00Z",
    to: "2026-05-04T17:00:00Z",
    minutes: 60,
    limit: 2,
  });
  assert.deepEqual(result.free, [
    { start: "2026-05-04T09:00:00.000Z", end: "2026-05-04T10:00:00.000Z" },
    { start: "2026-05-04T11:00:00.000Z", end: "2026-05-04T13:00:00.000Z" },
  ]);
  assert.deepEqual(
    result.busy.map((b) => b.start),
    ["2026-05-04T10:00:00.000Z", "2026-05-04T13:00:00.000Z"],
  );
  assert.deepEqual(fake.seen.at(-1)?.body, {
    timeMin: "2026-05-04T09:00:00Z",
    timeMax: "2026-05-04T17:00:00Z",
    items: [{ id: "primary" }],
  });
});

test("Gmail search requests repeated metadata headers, and reading caps text while retaining attachment names", async () => {
  const { g, start, fake } = setup();
  await g.finish("good-code", start("gmail").searchParams.get("state") ?? "");
  fake.respond((url) =>
    url.pathname.endsWith("/messages")
      ? { messages: [{ id: "message/1" }] }
      : {
          id: "message/1",
          threadId: "thread-1",
          labelIds: ["UNREAD"],
          payload: {
            mimeType: "multipart/mixed",
            headers: [
              { name: "From", value: "user@example.com" },
              { name: "Cc", value: "copy@example.com" },
            ],
            parts: [
              { mimeType: "text/plain", body: { data: Buffer.from("x".repeat(9000)).toString("base64url") } },
              { filename: "invoice.pdf" },
            ],
          },
        },
  );
  const api = gmailApi(g);
  const results = await api.search({ q: "is:unread", max: 5 });
  assert.equal(results.length, 1);
  assert.equal(results[0]?.subject, "(no subject)");
  assert.equal(results[0]?.unread, true);
  const metadata = new URL(fake.seen.at(-1)?.url ?? "");
  assert.ok(metadata.pathname.endsWith("/message%2F1"));
  assert.deepEqual(metadata.searchParams.getAll("metadataHeaders"), ["From", "To", "Subject", "Date"]);
  const read = await api.read("message/1");
  assert.equal(read.body, `${"x".repeat(8000)}\n…[cut]`);
  assert.equal(read.cc, "copy@example.com");
  assert.deepEqual(read.attachments, ["invoice.pdf"]);
  assert.equal(new URL(fake.seen.at(-1)?.url ?? "").searchParams.get("format"), "full");
  fake.respond(() => ({}));
  assert.deepEqual(await api.search({ q: "missing", max: 5 }), []);
});

test("Gmail reply drafts preserve threading and send only an existing draft id", async () => {
  const { g, start, fake } = setup();
  await g.finish("good-code", start("gmail").searchParams.get("state") ?? "");
  fake.respond((url) =>
    url.pathname.includes("/messages/")
      ? {
          threadId: "thread-1",
          payload: {
            headers: [
              { name: "Subject", value: "Re: Planning" },
              { name: "Message-ID", value: "<message@example.com>" },
              { name: "References", value: "<earlier@example.com>" },
            ],
          },
        }
      : url.pathname.endsWith("/drafts/send")
        ? { id: "sent-1", threadId: "thread-1" }
        : { id: "draft-1", message: { id: "message-1" } },
  );
  const api = gmailApi(g);
  assert.deepEqual(
    await api.draft({ to: ["user@example.com"], cc: ["copy@example.com"], body: "Confirmed", reply_to: "original" }),
    { draft: "draft-1", message: "message-1", subject: "Re: Planning" },
  );
  const body = fake.seen.at(-1)?.body as { message: { raw: string; threadId: string } };
  assert.equal(body.message.threadId, "thread-1");
  const raw = Buffer.from(body.message.raw, "base64url").toString("utf8");
  assert.match(raw, /Cc: copy@example.com\r\n/);
  assert.match(raw, /Subject: Re: Planning\r\n/);
  assert.match(raw, /References: <earlier@example.com> <message@example.com>\r\n/);
  assert.deepEqual(await api.sendDraft("draft-1"), { message: "sent-1", thread: "thread-1" });
  assert.deepEqual(fake.seen.at(-1)?.body, { id: "draft-1" });
  assert.ok(fake.seen.at(-1)?.url.endsWith("/drafts/send"));
});

test("Calendar adds and removes guests on the current list, keeps their answers, adds Meet once, and cancels", async () => {
  const { g, start, fake } = setup();
  await g.finish("good-code", start().searchParams.get("state") ?? "");
  let current: Record<string, unknown> = {
    id: "e1",
    summary: "Planning",
    attendees: [
      { email: "owner@example.com", organizer: true, responseStatus: "accepted" },
      { email: "Ana@example.com", responseStatus: "accepted" },
    ],
  };
  fake.respond((_url, init) =>
    init?.method === "PATCH" ? { ...current, ...(parsed(String(init.body)) as object) } : current,
  );
  const api = calendarApi(g);
  await api.update({
    calendar: "primary",
    id: "e1",
    add_attendees: ["bob@example.com", "ana@example.com", "bob@example.com"],
    remove_attendees: ["nobody@example.com"],
    meet: true,
  });
  assert.equal(fake.seen.at(-2)?.method, "GET", "the current guests are read first");
  const patch = fake.seen.at(-1);
  const body = patch?.body as { attendees: unknown; conferenceData?: unknown };
  assert.deepEqual(body.attendees, [
    { email: "owner@example.com", organizer: true, responseStatus: "accepted" },
    { email: "Ana@example.com", responseStatus: "accepted" },
    { email: "bob@example.com" },
  ]);
  assert.ok(body.conferenceData, "an event without Meet gets one");
  assert.equal(new URL(patch?.url ?? "").searchParams.get("conferenceDataVersion"), "1");

  current = { ...current, hangoutLink: "https://meet.google.com/abc" };
  await api.update({ calendar: "primary", id: "e1", remove_attendees: ["ANA@example.com"], meet: true });
  const again = fake.seen.at(-1)?.body as { attendees: Array<{ email: string }>; conferenceData?: unknown };
  assert.deepEqual(
    again.attendees.map((a) => a.email),
    ["owner@example.com"],
  );
  assert.equal(again.conferenceData, undefined, "a second Meet link is never asked for");

  await api.update({ calendar: "primary", id: "e1", title: "Retro" });
  assert.equal(fake.seen.at(-1)?.method, "PATCH", "a plain change reads nothing first");
  assert.equal(fake.seen.at(-2)?.method, "PATCH");

  await api.cancel({ calendar: "primary", id: "e1" });
  const del = fake.seen.at(-1);
  assert.equal(del?.method, "DELETE");
  assert.equal(new URL(del?.url ?? "").searchParams.get("sendUpdates"), "all");
});

test("a Drive query escapes the words and never lists the trash", () => {
  assert.equal(driveQuery({}), "trashed = false");
  assert.equal(
    driveQuery({ q: "Acme's \\ plan", kind: "doc" }),
    "trashed = false and fullText contains 'Acme\\'s \\\\ plan' and mimeType = 'application/vnd.google-apps.document'",
  );
});

test("Drive finds files, reads Google's formats as text and text files as they are, and refuses binaries", async () => {
  const { g, start, fake } = setup();
  await g.finish("good-code", start("google-drive").searchParams.get("state") ?? "");
  assert.match(start("google-drive").searchParams.get("scope") ?? "", /drive\.readonly.*drive\.file/);
  const meta: Record<string, { mimeType: string; name: string }> = {
    d1: { mimeType: "application/vnd.google-apps.document", name: "Plan" },
    s1: { mimeType: "application/vnd.google-apps.spreadsheet", name: "Budget" },
    t1: { mimeType: "text/markdown", name: "notes.md" },
    p1: { mimeType: "image/png", name: "logo.png" },
  };
  fake.respond((url) => {
    const id = url.pathname.split("/")[4] ?? "";
    if (url.pathname.endsWith("/drive/v3/files"))
      return { files: [{ id: "d1", ...meta.d1, owners: [{ emailAddress: "ana@example.com" }] }] };
    if (url.pathname.endsWith("/export") || url.searchParams.get("alt") === "media")
      return new Response(id === "d1" ? "x".repeat(25_000) : `text of ${id}`);
    return { id, ...meta[id], webViewLink: `https://docs.example.com/${id}` };
  });
  const api = driveApi(g);
  assert.deepEqual(await api.search({ max: 5 }), [{ id: "d1", name: "Plan", type: "doc", owner: "ana@example.com" }]);
  const listed = new URL(fake.seen.at(-1)?.url ?? "");
  assert.equal(listed.searchParams.get("orderBy"), "modifiedTime desc", "without words: the newest first");
  await api.search({ q: "budget", max: 5 });
  assert.equal(new URL(fake.seen.at(-1)?.url ?? "").searchParams.get("orderBy"), null, "Drive refuses it with words");

  const doc = await api.read("d1");
  assert.equal(doc.file.type, "doc");
  assert.ok(doc.text.endsWith("…[cut]") && doc.text.length < 20_100, "a long file is cut");
  assert.equal(new URL(fake.seen.at(-1)?.url ?? "").searchParams.get("mimeType"), "text/plain");
  assert.equal((await api.read("s1")).text, "text of s1");
  assert.equal(new URL(fake.seen.at(-1)?.url ?? "").searchParams.get("mimeType"), "text/csv");
  assert.equal((await api.read("t1")).text, "text of t1");
  assert.equal(new URL(fake.seen.at(-1)?.url ?? "").searchParams.get("alt"), "media");
  await assert.rejects(api.read("p1"), /cannot read as text; open https:\/\/docs\.example\.com\/p1/);
});

test("Drive writes a Doc as one upload, rewrites one by id, and shares it with each person", async () => {
  const { g, start, fake } = setup();
  await g.finish("good-code", start("google-drive").searchParams.get("state") ?? "");
  fake.respond((url) => ({ id: url.pathname.split("/").at(-1) === "files" ? "new1" : "d9", name: "Agenda" }));
  const api = driveApi(g);
  assert.deepEqual(await api.writeDoc({ title: "Agenda", content: "1. Budget\n2. Dates", folder: "f1" }), {
    id: "new1",
    name: "Agenda",
    type: "",
  });
  const made = fake.seen.at(-1);
  assert.equal(made?.method, "POST");
  assert.equal(new URL(made?.url ?? "").pathname, "/upload/drive/v3/files");
  assert.equal(new URL(made?.url ?? "").searchParams.get("uploadType"), "multipart");
  const raw = String(made?.body);
  assert.match(raw, /"name":"Agenda","mimeType":"application\/vnd\.google-apps\.document","parents":\["f1"\]/);
  assert.match(raw, /Content-Type: text\/plain; charset=UTF-8\r\n\r\n1\. Budget\n2\. Dates\r\n--apx-/);

  await api.writeDoc({ id: "d9", content: "new text" });
  const rewrite = fake.seen.at(-1);
  assert.equal(rewrite?.method, "PATCH");
  assert.equal(new URL(rewrite?.url ?? "").pathname, "/upload/drive/v3/files/d9");
  assert.doesNotMatch(String(rewrite?.body), /mimeType|parents/, "a rewrite keeps the Doc where and what it is");

  await api.share({
    id: "d9",
    emails: ["ana@example.com", "bob@example.com"],
    role: "commenter",
    message: "For Monday",
  });
  const grants = fake.seen.filter((s) => s.url.includes("/permissions"));
  assert.deepEqual(
    grants.map((s) => s.body),
    [
      { type: "user", role: "commenter", emailAddress: "ana@example.com" },
      { type: "user", role: "commenter", emailAddress: "bob@example.com" },
    ],
  );
  assert.equal(new URL(grants[0]?.url ?? "").searchParams.get("emailMessage"), "For Monday");
});

test("Gmail send with APX's client posts one UTF-8 message, never a draft", async () => {
  const { g, fake } = setup({ builtin: true });
  const url = new URL(g.start("gmail", {}));
  fake.setChallenge(url.searchParams.get("code_challenge") ?? "");
  await g.finish("good-code", url.searchParams.get("state") ?? "");
  fake.respond(() => ({ id: "sent-9", threadId: "thread-9" }));
  assert.deepEqual(
    await gmailApi(g).send({ to: ["ana@example.com"], subject: "Reunión", body: "Nos vemos el lunes" }),
    { message: "sent-9", thread: "thread-9" },
  );
  const sent = fake.seen.at(-1);
  assert.ok(sent);
  assert.ok(sent.url.endsWith("/users/me/messages/send"));
  const raw = Buffer.from((sent.body as { raw: string }).raw, "base64url").toString("utf8");
  assert.match(raw, /^To: ana@example\.com\r\n/);
  assert.match(raw, /Subject: =\?UTF-8\?B\?/);
});

test("Gmail says where the inbox stands and what reached it since, oldest first; too old a point starts again", async () => {
  const { g, start, fake } = setup();
  await g.finish("good-code", start("gmail").searchParams.get("state") ?? "");
  fake.respond((url) => {
    if (url.pathname.endsWith("/profile")) return { historyId: "100" };
    if (url.pathname.endsWith("/history")) {
      if (url.searchParams.get("startHistoryId") === "1")
        return new Response(JSON.stringify({ error: { message: "Requested entity was not found." } }), { status: 404 });
      return {
        historyId: "130",
        history: [
          { messagesAdded: [{ message: { id: "a" } }] },
          { messagesAdded: [{ message: { id: "b" } }, { message: { id: "a" } }] },
        ],
      };
    }
    const id = url.pathname.split("/").at(-1);
    return {
      id,
      threadId: `t-${id}`,
      labelIds: id === "a" ? ["INBOX", "IMPORTANT", "UNREAD"] : ["INBOX", "CATEGORY_PROMOTIONS"],
      payload: {
        headers: [
          { name: "From", value: `${id}@example.com` },
          { name: "Subject", value: `Hi ${id}` },
        ],
      },
    };
  });
  const api = gmailApi(g);
  assert.equal(await api.historyId(), "100");
  const got = await api.arrived("100");
  const q = new URL(fake.seen.find((s) => s.url.includes("/history"))?.url ?? "").searchParams;
  assert.equal(q.get("startHistoryId"), "100");
  assert.equal(q.get("labelId"), "INBOX");
  assert.equal(got?.next, "130");
  assert.deepEqual(
    got?.mail.map((m) => [m.id, m.from, m.labels.includes("IMPORTANT")]),
    [
      ["a", "a@example.com", true],
      ["b", "b@example.com", false],
    ],
    "each message once, in the order it arrived",
  );
  assert.equal(await api.arrived("1"), undefined);
});
