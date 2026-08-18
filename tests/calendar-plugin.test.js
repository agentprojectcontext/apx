// The Google Calendar plugin (02-SPEC-capabilities.md § C6, the native adapter).
//
// The claim under test: a calendar is a paste-a-credential integration like
// every other one in the catalog, NOT an OAuth client. A service account signs
// its own assertion, trades it for an access token, and reads a calendar that
// was shared with it. Nothing here talks to Google — `fetchImpl` is injected,
// which is also how the error paths get exercised at all.
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";

const cal = await import("#core/integrations/plugins/calendar.js");
const { listCatalog, getPluginService } = await import("#core/integrations/index.js");

// A throwaway RSA pair: the signature has to verify, so a fake string will not do.
const { privateKey, publicKey } = crypto.generateKeyPairSync("rsa", { modulusLength: 2048 });
const KEY = {
  type: "service_account",
  client_email: "apx@proyecto.iam.gserviceaccount.com",
  private_key: privateKey.export({ type: "pkcs8", format: "pem" }),
};
const CONFIG = { service_account_json: JSON.stringify(KEY), calendar_id: "manu@gmail.com" };

/** A fetch that answers the token endpoint and records what it was asked. */
function fakeGoogle(routes = {}) {
  const calls = [];
  const impl = async (url, init = {}) => {
    const u = String(url);
    calls.push({ url: u, method: init.method || "GET", body: init.body });
    if (u.startsWith("https://oauth2.googleapis.com/token")) {
      return { ok: true, status: 200, json: async () => ({ access_token: "ya29.fake", expires_in: 3600 }) };
    }
    for (const [match, answer] of Object.entries(routes)) {
      if (u.includes(match)) return answer(u, init);
    }
    return { ok: true, status: 200, json: async () => ({ items: [] }) };
  };
  return { impl, calls };
}

const ok = (body) => () => ({ ok: true, status: 200, json: async () => body });
const fail = (status, message) => () => ({ ok: false, status, json: async () => ({ error: { message } }) });

beforeEach(() => cal.clearTokenCache());

// --------------------------------------------------------------------------
// credentials
// --------------------------------------------------------------------------

test("the key can be pasted or pointed at, and a wrong kind of key says so", () => {
  assert.equal(cal.readKey(CONFIG).client_email, KEY.client_email);

  // The mistake worth naming: downloading an OAuth client secret, which looks
  // like a credential and is not this one.
  assert.throws(
    () => cal.readKey({ service_account_json: JSON.stringify({ type: "authorized_user", client_id: "x" }) }),
    /not a service account/,
  );
  assert.throws(() => cal.readKey({ service_account_json: "{oops" }), /not valid JSON/);
  assert.throws(() => cal.readKey({}), /paste the JSON or point at the key file/);
});

test("the assertion is a real RS256 JWT Google could verify", () => {
  const jwt = cal.signAssertion(cal.readKey(CONFIG), cal.SCOPE_READ, { now: 1_700_000_000 });
  const [h, c, sig] = jwt.split(".");

  const claims = JSON.parse(Buffer.from(c, "base64url").toString());
  assert.equal(claims.iss, KEY.client_email);
  assert.equal(claims.aud, "https://oauth2.googleapis.com/token");
  assert.equal(claims.scope, cal.SCOPE_READ);
  assert.equal(claims.exp - claims.iat, 3600);

  assert.ok(
    crypto.createVerify("RSA-SHA256").update(`${h}.${c}`).verify(publicKey, Buffer.from(sig, "base64url")),
    "the signature must verify against the public half of the key",
  );
});

test("read-only is the default scope; writing is opt-in", () => {
  const read = JSON.parse(Buffer.from(cal.signAssertion(cal.readKey(CONFIG), cal.SCOPE_READ).split(".")[1], "base64url"));
  assert.match(read.scope, /calendar\.readonly$/);
  assert.equal(cal.SCOPE_WRITE, "https://www.googleapis.com/auth/calendar");
});

test("the access token is fetched once and reused", async () => {
  const { impl, calls } = fakeGoogle();
  await cal.getAccessToken(CONFIG, { fetchImpl: impl });
  await cal.getAccessToken(CONFIG, { fetchImpl: impl });

  assert.equal(calls.filter((c) => c.url.includes("oauth2")).length, 1, "one token round-trip, not two");
});

test("a key Google rejects reports what Google said", async () => {
  const impl = async () => ({ ok: false, status: 400, json: async () => ({ error_description: "Invalid JWT Signature." }) });
  await assert.rejects(
    () => cal.getAccessToken(CONFIG, { fetchImpl: impl }),
    /Google refused the service account key: Invalid JWT Signature/,
  );
});

// --------------------------------------------------------------------------
// reading a calendar
// --------------------------------------------------------------------------

test("events come back flattened to what a prompt needs", async () => {
  const { impl } = fakeGoogle({
    "/events": ok({
      items: [
        {
          id: "e1",
          summary: "llamada con Ana",
          start: { dateTime: "2026-08-19T09:30:00-03:00" },
          end: { dateTime: "2026-08-19T10:00:00-03:00" },
          attendees: [{ email: "ana@x.com" }, { displayName: "sin mail" }],
          htmlLink: "https://cal/e1",
        },
        { id: "e2", summary: "feriado", start: { date: "2026-08-19" }, end: { date: "2026-08-20" } },
      ],
    }),
  });

  const events = await cal.listEvents(CONFIG, { calendarId: "manu@gmail.com" }, { fetchImpl: impl });

  assert.deepEqual(events[0], {
    id: "e1",
    title: "llamada con Ana",
    start: "2026-08-19T09:30:00-03:00",
    end: "2026-08-19T10:00:00-03:00",
    all_day: false,
    location: null,
    attendees: ["ana@x.com"],
    status: null,
    link: "https://cal/e1",
  });
  assert.equal(events[1].all_day, true, "a date without a time is an all-day event");
});

test("a 404 says the calendar was never shared, because that is what it means", async () => {
  const { impl } = fakeGoogle({ "/events": fail(404, "Not Found") });

  await assert.rejects(
    () => cal.listEvents(CONFIG, { calendarId: "manu@gmail.com" }, { fetchImpl: impl }),
    /shared with the service account/,
  );
});

test("the events query asks for expanded, ordered occurrences", async () => {
  const { impl, calls } = fakeGoogle({ "/events": ok({ items: [] }) });
  await cal.listEvents(CONFIG, { calendarId: "a@b.c", timeMin: "2026-08-19T00:00:00Z" }, { fetchImpl: impl });

  const url = new URL(calls.find((c) => c.url.includes("/events")).url);
  // Without singleEvents a weekly stand-up is one row for the year, and the
  // model would report "no meetings today".
  assert.equal(url.searchParams.get("singleEvents"), "true");
  assert.equal(url.searchParams.get("orderBy"), "startTime");
  assert.equal(url.searchParams.get("timeMin"), "2026-08-19T00:00:00Z");
});

// --------------------------------------------------------------------------
// finding a gap
// --------------------------------------------------------------------------

test("free slots are computed from the busy blocks, not guessed", async () => {
  const { impl } = fakeGoogle({
    "/freeBusy": ok({
      calendars: {
        "manu@gmail.com": {
          busy: [
            { start: "2026-08-19T13:00:00Z", end: "2026-08-19T14:00:00Z" },
            { start: "2026-08-19T14:30:00Z", end: "2026-08-19T15:00:00Z" },
          ],
        },
      },
    }),
  });

  const slots = await cal.findSlots(
    CONFIG,
    { calendarId: "manu@gmail.com", timeMin: "2026-08-19T12:00:00Z", timeMax: "2026-08-19T17:00:00Z", minutes: 60 },
    { fetchImpl: impl },
  );

  // 12-13 fits an hour; 14:00-14:30 does not and must not be offered; 15-17 does.
  assert.deepEqual(slots, [
    { start: "2026-08-19T12:00:00.000Z", end: "2026-08-19T13:00:00.000Z" },
    { start: "2026-08-19T15:00:00.000Z", end: "2026-08-19T17:00:00.000Z" },
  ]);
});

test("a fully booked window offers nothing rather than something too short", async () => {
  const { impl } = fakeGoogle({
    "/freeBusy": ok({
      calendars: { "c": { busy: [{ start: "2026-08-19T12:00:00Z", end: "2026-08-19T17:00:00Z" }] } },
    }),
  });

  const slots = await cal.findSlots(
    CONFIG,
    { calendarId: "c", timeMin: "2026-08-19T12:00:00Z", timeMax: "2026-08-19T17:00:00Z", minutes: 30 },
    { fetchImpl: impl },
  );
  assert.deepEqual(slots, []);
});

// --------------------------------------------------------------------------
// the plugin lifecycle the panel drives
// --------------------------------------------------------------------------

test("it is a plugin in the catalog, like every other integration", () => {
  const entry = listCatalog().find((p) => p.slug === "calendar");

  assert.ok(entry, "calendar must be connectable from the panel, not only via MCP");
  assert.equal(entry.coming_soon, false);
  assert.equal(entry.auth, "service_account");
  assert.deepEqual(entry.tools.map((t) => t.slug), [
    "calendar_list_events",
    "calendar_find_slot",
    "calendar_create_event",
    "calendar_update_event",
  ]);
  assert.equal(getPluginService("calendar"), cal.calendarPlugin);
});

test("validate names the one mistake everybody makes", async () => {
  const plugin = getPluginService("calendar");
  const { impl } = fakeGoogle({ "/calendarList": ok({ items: [] }) });
  const original = globalThis.fetch;
  globalThis.fetch = impl;
  try {
    const out = await plugin.validate({ config: CONFIG });
    // A key that authenticates but sees nothing means the sharing step was
    // skipped. Saying "no calendars found" would send the owner back to Google
    // Cloud, which is the wrong console.
    assert.equal(out.result.ok, false);
    assert.match(out.result.error, /no calendar is shared with apx@proyecto\.iam\.gserviceaccount\.com/i);
    assert.match(out.result.error, /Share with specific people/);
    assert.equal(out.patch.status, "error");
  } finally {
    globalThis.fetch = original;
  }
});

test("a single shared calendar is selected without asking", async () => {
  const plugin = getPluginService("calendar");
  const { impl } = fakeGoogle({
    "/calendarList": ok({ items: [{ id: "manu@gmail.com", summary: "Manu", accessRole: "owner" }] }),
  });
  const original = globalThis.fetch;
  globalThis.fetch = impl;
  try {
    const out = await plugin.validate({ config: { service_account_json: CONFIG.service_account_json } });
    assert.equal(out.result.ok, true);
    assert.equal(out.patch.status, "active");
    assert.equal(out.patch.config.calendar_id, "manu@gmail.com");
    assert.equal(out.patch.config.client_email, KEY.client_email);
  } finally {
    globalThis.fetch = original;
  }
});

test("configure keeps write access off unless it is asked for", () => {
  const plugin = getPluginService("calendar");

  const off = plugin.configure(null, { key_file: "~/k.json" });
  assert.equal(off.patch.config.write_access, false);
  assert.equal(off.patch.status, "pending_validation", "a fresh key is not a verified connection");

  const on = plugin.configure({ config: { key_file: "~/k.json" } }, { write_access: "true" });
  assert.equal(on.patch.config.write_access, true);
  assert.equal(on.patch.status, "pending_validation", "changing the scope means re-validating");
});
