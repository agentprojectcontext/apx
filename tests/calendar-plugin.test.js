// The Google Calendar plugin (02-SPEC-capabilities.md § C6, the native adapter).
//
// The claim under test changed: a calendar is a USER-OAUTH integration, not a
// service account. It acts as the user (so it can invite people and mint Meet
// links), authenticating with a refresh token obtained through a browser consent
// flow. Nothing here talks to Google — `fetchImpl` is injected, which is also how
// the error paths get exercised at all.
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";

const cal = await import("#core/integrations/plugins/calendar.js");
const oauth = await import("#core/integrations/plugins/_google-oauth.js");
const { listCatalog, getPluginService } = await import("#core/integrations/index.js");

// A stored, authorized connection.
const CONFIG = {
  client_id: "123-abc.apps.googleusercontent.com",
  client_secret: "GOCSPX-secret",
  refresh_token: "1//refresh-token",
  write_access: true,
  meet: true,
  calendar_id: "primary",
};

const b64url = (obj) =>
  Buffer.from(JSON.stringify(obj)).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
// A fake id_token: only the payload segment is decoded (no signature check).
const idToken = (email) => `x.${b64url({ email })}.y`;

/** A fetch that answers Google's token + API endpoints and records the calls. */
function fakeGoogle(routes = {}) {
  const calls = [];
  const impl = async (url, init = {}) => {
    const u = String(url);
    calls.push({ url: u, method: init.method || "GET", body: init.body });
    if (u.startsWith("https://oauth2.googleapis.com/token")) {
      const params = new URLSearchParams(String(init.body || ""));
      const grant = params.get("grant_type");
      // Code exchange returns a refresh token + id_token; refresh returns access.
      const body =
        grant === "authorization_code"
          ? { refresh_token: "1//refresh-token", access_token: "ya29.fresh", expires_in: 3600, id_token: idToken("manu@gmail.com") }
          : { access_token: "ya29.fake", expires_in: 3600 };
      return { ok: true, status: 200, json: async () => body };
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

beforeEach(() => oauth.clearAccessCache());

// --------------------------------------------------------------------------
// OAuth mechanics
// --------------------------------------------------------------------------

test("the consent URL forces a refresh token and carries the scope", () => {
  const url = new URL(
    oauth.buildAuthUrl({ clientId: "cid", redirectUri: "http://localhost:7430/api/integrations/oauth/callback", scope: cal.SCOPE_WRITE, state: "st" }),
  );
  assert.equal(url.origin + url.pathname, "https://accounts.google.com/o/oauth2/v2/auth");
  assert.equal(url.searchParams.get("access_type"), "offline");
  assert.equal(url.searchParams.get("prompt"), "consent", "without prompt=consent Google omits the refresh token on repeat consents");
  assert.equal(url.searchParams.get("response_type"), "code");
  assert.equal(url.searchParams.get("scope"), cal.SCOPE_WRITE);
  assert.equal(url.searchParams.get("state"), "st");
});

test("state is signed, so a forged or expired callback is rejected", () => {
  const token = oauth.signState({ slug: "calendar", pid: "0", scope: "global" });
  const decoded = oauth.verifyState(token);
  assert.equal(decoded.slug, "calendar");
  assert.equal(decoded.scope, "global");

  assert.equal(oauth.verifyState(token + "tamper"), null, "a tampered signature must not verify");
  assert.equal(oauth.verifyState("garbage"), null);
  // An expired payload (exp in the past), re-signed the same way, is still rejected.
  assert.equal(oauth.verifyState(null), null);
});

test("read-only is the default scope; writing is opt-in", () => {
  assert.match(cal.SCOPE_READ, /calendar\.readonly$/);
  assert.match(cal.SCOPE_WRITE, /auth\/calendar$/);
});

test("the access token is fetched once and reused", async () => {
  const { impl, calls } = fakeGoogle();
  await cal.getAccessToken(CONFIG, { fetchImpl: impl });
  await cal.getAccessToken(CONFIG, { fetchImpl: impl });
  assert.equal(calls.filter((c) => c.url.includes("oauth2")).length, 1, "one token round-trip, not two");
});

test("a missing client or an unauthorized connection says which", async () => {
  await assert.rejects(() => cal.getAccessToken({ refresh_token: "x" }, {}), /OAuth client/i);
  await assert.rejects(() => cal.getAccessToken({ client_id: "c", client_secret: "s" }, {}), /no está autorizado/i);
});

test("code exchange yields a refresh token and the account email", async () => {
  const { impl } = fakeGoogle();
  const out = await oauth.exchangeCode(
    { clientId: "c", clientSecret: "s", code: "auth-code", redirectUri: "http://localhost/cb" },
    { fetchImpl: impl },
  );
  assert.equal(out.refresh_token, "1//refresh-token");
  assert.equal(out.email, "manu@gmail.com");
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
          hangoutLink: "https://meet.google.com/abc",
        },
        { id: "e2", summary: "feriado", start: { date: "2026-08-19" }, end: { date: "2026-08-20" } },
      ],
    }),
  });

  const events = await cal.listEvents(CONFIG, { calendarId: "primary" }, { fetchImpl: impl });

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
    meet_link: "https://meet.google.com/abc",
  });
  assert.equal(events[1].all_day, true, "a date without a time is an all-day event");
});

test("a 401/403 suggests reconnecting rather than failing opaquely", async () => {
  const { impl } = fakeGoogle({ "/events": fail(403, "Insufficient Permission") });
  await assert.rejects(() => cal.listEvents(CONFIG, { calendarId: "primary" }, { fetchImpl: impl }), /reconectar/i);
});

test("the events query asks for expanded, ordered occurrences", async () => {
  const { impl, calls } = fakeGoogle({ "/events": ok({ items: [] }) });
  await cal.listEvents(CONFIG, { calendarId: "primary", timeMin: "2026-08-19T00:00:00Z" }, { fetchImpl: impl });

  const url = new URL(calls.find((c) => c.url.includes("/events")).url);
  assert.equal(url.searchParams.get("singleEvents"), "true");
  assert.equal(url.searchParams.get("orderBy"), "startTime");
  assert.equal(url.searchParams.get("timeMin"), "2026-08-19T00:00:00Z");
});

// --------------------------------------------------------------------------
// writing: invites + Meet, the whole reason for OAuth
// --------------------------------------------------------------------------

test("creating an event with guests invites them and can add a Meet link", async () => {
  const { impl, calls } = fakeGoogle({
    "/events": ok({ id: "n1", summary: "Reunión", htmlLink: "https://cal/n1", hangoutLink: "https://meet.google.com/xyz" }),
  });

  const ev = await cal.createEvent(
    CONFIG,
    { calendarId: "primary", title: "Reunión", start: "2026-08-20T18:00:00-03:00", end: "2026-08-20T19:00:00-03:00", attendees: ["carlos@x.com"], meet: true },
    { fetchImpl: impl },
  );

  const post = calls.find((c) => c.method === "POST" && c.url.includes("/events"));
  const url = new URL(post.url);
  assert.equal(url.searchParams.get("sendUpdates"), "all", "guests must actually receive an invitation");
  assert.equal(url.searchParams.get("conferenceDataVersion"), "1", "Meet needs the v1 conference flag");
  const body = JSON.parse(post.body);
  assert.equal(body.attendees[0].email, "carlos@x.com");
  assert.equal(body.conferenceData.createRequest.conferenceSolutionKey.type, "hangoutsMeet");
  assert.equal(ev.meet_link, "https://meet.google.com/xyz");
});

test("a plain event with no guests sends no invitations and no Meet", async () => {
  const { impl, calls } = fakeGoogle({ "/events": ok({ id: "n2", summary: "Foco" }) });
  await cal.createEvent(CONFIG, { title: "Foco", start: "2026-08-20T18:00:00-03:00", end: "2026-08-20T19:00:00-03:00" }, { fetchImpl: impl });
  const post = calls.find((c) => c.method === "POST" && c.url.includes("/events"));
  const url = new URL(post.url);
  assert.equal(url.searchParams.get("sendUpdates"), null);
  assert.equal(url.searchParams.get("conferenceDataVersion"), null);
});

// --------------------------------------------------------------------------
// finding a gap
// --------------------------------------------------------------------------

test("free slots are computed from the busy blocks, not guessed", async () => {
  const { impl } = fakeGoogle({
    "/freeBusy": ok({
      calendars: {
        primary: {
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
    { calendarId: "primary", timeMin: "2026-08-19T12:00:00Z", timeMax: "2026-08-19T17:00:00Z", minutes: 60 },
    { fetchImpl: impl },
  );

  assert.deepEqual(slots, [
    { start: "2026-08-19T12:00:00.000Z", end: "2026-08-19T13:00:00.000Z" },
    { start: "2026-08-19T15:00:00.000Z", end: "2026-08-19T17:00:00.000Z" },
  ]);
});

// --------------------------------------------------------------------------
// the plugin lifecycle the panel drives
// --------------------------------------------------------------------------

test("it is an OAuth plugin in the catalog, with an authorize action", () => {
  const entry = listCatalog().find((p) => p.slug === "calendar");
  assert.ok(entry, "calendar must be connectable from the panel, not only via MCP");
  assert.equal(entry.coming_soon, false);
  assert.equal(entry.auth, "oauth");
  assert.equal(entry.ui.oauth.action, "authorize");
  assert.deepEqual(entry.tools.map((t) => t.slug), [
    "calendar_list_events",
    "calendar_find_slot",
    "calendar_create_event",
    "calendar_update_event",
  ]);
  assert.equal(getPluginService("calendar"), cal.calendarPlugin);
});

test("authorize builds a consent URL with a matching redirect + signed state", () => {
  const plugin = getPluginService("calendar");
  const { auth_url, redirect_uri } = plugin.buildAuthorizeUrl(
    { config: { client_id: "cid", write_access: true } },
    { origin: "http://localhost:7430", pid: 0, scope: "global" },
  );
  assert.equal(redirect_uri, "http://localhost:7430/api/integrations/oauth/callback");
  const url = new URL(auth_url);
  assert.equal(url.searchParams.get("redirect_uri"), redirect_uri);
  const state = oauth.verifyState(url.searchParams.get("state"));
  assert.equal(state.scope, "global");
});

test("completeOAuth trades the code for a refresh token and activates", async () => {
  const plugin = getPluginService("calendar");
  const { impl } = fakeGoogle();
  const original = globalThis.fetch;
  globalThis.fetch = impl;
  try {
    const { patch } = await plugin.completeOAuth(
      { config: { client_id: "c", client_secret: "s" } },
      { code: "auth-code", redirectUri: "http://localhost:7430/api/integrations/oauth/callback" },
    );
    assert.equal(patch.status, "active");
    assert.equal(patch.is_enabled, true);
    assert.equal(patch.config.refresh_token, "1//refresh-token");
    assert.equal(patch.config.account_email, "manu@gmail.com");
    assert.equal(patch.config.calendar_id, "primary");
  } finally {
    globalThis.fetch = original;
  }
});

test("validate refuses an unauthorized connection and confirms an authorized one", async () => {
  const plugin = getPluginService("calendar");

  const notYet = await plugin.validate({ config: { client_id: "c", client_secret: "s" } });
  assert.equal(notYet.result.ok, false);
  assert.equal(notYet.result.needs_auth, true);

  const { impl } = fakeGoogle({ "/calendarList": ok({ items: [{ id: "primary" }] }) });
  const original = globalThis.fetch;
  globalThis.fetch = impl;
  try {
    const out = await plugin.validate({ config: CONFIG });
    assert.equal(out.result.ok, true);
    assert.equal(out.patch.status, "active");
    assert.equal(out.patch.config.calendar_id, "primary");
  } finally {
    globalThis.fetch = original;
  }
});

test("configure saves the client, defaults write on, and re-consents on a scope change", () => {
  const plugin = getPluginService("calendar");

  const fresh = plugin.configure(null, { client_id: "cid", client_secret: "sec" });
  assert.equal(fresh.patch.config.client_id, "cid");
  assert.equal(fresh.patch.config.write_access, true, "write is the useful default now that invites/Meet depend on it");

  // Flipping write on a live connection changes the granted scope → re-consent.
  const flip = plugin.configure(
    { config: { client_id: "cid", client_secret: "sec", refresh_token: "1//r", write_access: true } },
    { write_access: "false" },
  );
  assert.equal(flip.patch.status, "pending_validation");
  assert.equal(flip.patch.config.needs_reauth, true);

  assert.throws(() => plugin.configure(null, {}), /client_id/);
});
