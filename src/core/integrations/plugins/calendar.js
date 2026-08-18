// Google Calendar integration plugin — and, deliberately, NOT an OAuth client.
//
// Every other plugin here takes a credential you can paste (Asana PAT, GitHub
// PAT) or a path you can pick (Obsidian vault). A calendar looks like it breaks
// that model, because the consumer path for Google is OAuth2: a client id and
// secret, a browser consent round-trip, and refresh tokens to store and rotate.
// APX has none of that machinery, and building it for one integration is the
// wrong order.
//
// A service account skips the whole dance. You create one, take its email, and
// SHARE YOUR CALENDAR WITH IT from Google Calendar's own settings — the same
// gesture as sharing with a colleague. The credential is then a JSON key file:
// something you can paste or point at, exactly like every other plugin. There
// is no consent screen, no refresh token that expires in seven days, and no app
// verification, because nothing here acts on behalf of a user — it acts as
// itself, on a calendar you handed it.
//
// The cost of that choice, stated plainly: a service account cannot send
// invitations to other people without domain-wide delegation (a Workspace
// feature). Reading your agenda and creating or moving events on a calendar
// shared with it works.
//
// Auth flow: sign a JWT with the key (RS256), exchange it at Google's token
// endpoint for a one-hour access token, cache it in memory. ~40 lines of
// node:crypto, no Google SDK.
import fs from "node:fs";
import crypto from "node:crypto";
import path from "node:path";
import os from "node:os";

const TOKEN_URL = "https://oauth2.googleapis.com/token";
const API = "https://www.googleapis.com/calendar/v3";

// Read-only unless the owner asks for more. A calendar an agent can write to is
// a calendar an agent can change other people's days with.
export const SCOPE_READ = "https://www.googleapis.com/auth/calendar.readonly";
export const SCOPE_WRITE = "https://www.googleapis.com/auth/calendar";

// ─── credentials ────────────────────────────────────────────────────────────

function expandHome(p) {
  const s = String(p || "");
  if (s === "~") return os.homedir();
  if (s.startsWith("~/") || s.startsWith("~\\")) return path.join(os.homedir(), s.slice(2));
  return s;
}

/**
 * The service account key, from whichever of the two ways it was given: pasted
 * JSON, or a path to the file Google downloaded. The path form is the better
 * one — the private key never enters APX's own config.
 */
export function readKey(config = {}) {
  const pasted = String(config.service_account_json || "").trim();
  const file = String(config.key_file || "").trim();

  let raw = pasted;
  if (!raw) {
    if (!file) throw new Error("No service account key: paste the JSON or point at the key file");
    const resolved = path.resolve(expandHome(file));
    try {
      raw = fs.readFileSync(resolved, "utf8");
    } catch {
      throw new Error(`Cannot read the key file: ${resolved}`);
    }
  }

  let key;
  try {
    key = JSON.parse(raw);
  } catch {
    throw new Error("The service account key is not valid JSON");
  }
  if (key.type && key.type !== "service_account") {
    throw new Error(
      `That is a "${key.type}" key, not a service account. Create a service account key in Google Cloud Console → IAM → Service Accounts → Keys.`
    );
  }
  if (!key.client_email || !key.private_key) {
    throw new Error("The key is missing client_email or private_key");
  }
  return key;
}

// ─── access tokens ──────────────────────────────────────────────────────────

const base64url = (buf) =>
  Buffer.from(buf).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

/** A signed JWT assertion — the thing Google trades for an access token. */
export function signAssertion(key, scope, { now = Math.floor(Date.now() / 1000) } = {}) {
  const header = { alg: "RS256", typ: "JWT" };
  const claims = {
    iss: key.client_email,
    scope,
    aud: TOKEN_URL,
    iat: now,
    exp: now + 3600,
  };
  const body = `${base64url(JSON.stringify(header))}.${base64url(JSON.stringify(claims))}`;
  const signature = crypto.createSign("RSA-SHA256").update(body).sign(key.private_key);
  return `${body}.${base64url(signature)}`;
}

// Access tokens last an hour and cost a network round-trip. The morning anchor
// asking twice in one turn should not pay for it twice.
const tokenCache = new Map();

export function clearTokenCache() {
  tokenCache.clear();
}

export async function getAccessToken(config = {}, { fetchImpl = fetch } = {}) {
  const key = readKey(config);
  const scope = config.write_access ? SCOPE_WRITE : SCOPE_READ;
  const cacheKey = `${key.client_email}:${scope}`;

  const hit = tokenCache.get(cacheKey);
  // 60s of slack: a token that expires mid-request is a failure with a
  // confusing error message.
  if (hit && hit.expires_at - 60_000 > Date.now()) return hit.access_token;

  const res = await fetchImpl(TOKEN_URL, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: signAssertion(key, scope),
    }).toString(),
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.access_token) {
    const detail = data.error_description || data.error || `HTTP ${res.status}`;
    throw new Error(`Google refused the service account key: ${detail}`);
  }
  tokenCache.set(cacheKey, {
    access_token: data.access_token,
    expires_at: Date.now() + (Number(data.expires_in) || 3600) * 1000,
  });
  return data.access_token;
}

// ─── REST client ────────────────────────────────────────────────────────────

async function call(config, urlPath, { method = "GET", query, body, fetchImpl = fetch } = {}) {
  const token = await getAccessToken(config, { fetchImpl });
  const url = new URL(API + urlPath);
  for (const [k, v] of Object.entries(query || {})) {
    if (v !== undefined && v !== null && v !== "") url.searchParams.set(k, String(v));
  }
  const res = await fetchImpl(url.toString(), {
    method,
    headers: {
      authorization: `Bearer ${token}`,
      ...(body ? { "content-type": "application/json" } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = data?.error?.message || `HTTP ${res.status}`;
    // The one mistake everybody makes, worth catching by name: the key works,
    // the calendar was never shared with the service account.
    if (res.status === 404 || res.status === 403) {
      throw new Error(
        `${msg} — check the calendar is shared with the service account. Google Calendar → Settings → your calendar → "Share with specific people" → add the service account email.`
      );
    }
    throw new Error(msg);
  }
  return data;
}

/** Calendars this service account can see — i.e. the ones shared with it. */
export async function listCalendars(config, opts = {}) {
  const data = await call(config, "/users/me/calendarList", { ...opts });
  return (data.items || []).map((c) => ({
    id: c.id,
    summary: c.summary || c.id,
    timeZone: c.timeZone || null,
    accessRole: c.accessRole || null,
    primary: !!c.primary,
  }));
}

/** One event, flattened to what a prompt actually needs. */
function flattenEvent(e) {
  return {
    id: e.id,
    title: e.summary || "(sin título)",
    start: e.start?.dateTime || e.start?.date || null,
    end: e.end?.dateTime || e.end?.date || null,
    all_day: !!e.start?.date,
    location: e.location || null,
    attendees: (e.attendees || []).map((a) => a.email).filter(Boolean),
    status: e.status || null,
    link: e.htmlLink || null,
  };
}

export async function listEvents(config, { calendarId, timeMin, timeMax, q, maxResults = 25 } = {}, opts = {}) {
  const data = await call(config, `/calendars/${encodeURIComponent(calendarId)}/events`, {
    query: {
      timeMin,
      timeMax,
      q,
      maxResults,
      singleEvents: true,
      orderBy: "startTime",
    },
    ...opts,
  });
  return (data.items || []).map(flattenEvent);
}

export async function createEvent(config, { calendarId, title, start, end, description, location, attendees } = {}, opts = {}) {
  const data = await call(config, `/calendars/${encodeURIComponent(calendarId)}/events`, {
    method: "POST",
    body: {
      summary: title,
      description: description || undefined,
      location: location || undefined,
      start: { dateTime: start },
      end: { dateTime: end },
      ...(attendees?.length ? { attendees: attendees.map((email) => ({ email })) } : {}),
    },
    ...opts,
  });
  return flattenEvent(data);
}

export async function updateEvent(config, { calendarId, eventId, ...fields } = {}, opts = {}) {
  const body = {};
  if (fields.title !== undefined) body.summary = fields.title;
  if (fields.description !== undefined) body.description = fields.description;
  if (fields.location !== undefined) body.location = fields.location;
  if (fields.start !== undefined) body.start = { dateTime: fields.start };
  if (fields.end !== undefined) body.end = { dateTime: fields.end };
  const data = await call(config, `/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}`, {
    method: "PATCH",
    body,
    ...opts,
  });
  return flattenEvent(data);
}

/**
 * The first gaps of at least `minutes` between timeMin and timeMax, from
 * Google's freeBusy view. Pure arithmetic once the busy blocks are in: the
 * model should never be asked to work out whether 11:20–11:50 fits an hour.
 */
export async function findSlots(config, { calendarId, timeMin, timeMax, minutes = 30, limit = 5 } = {}, opts = {}) {
  const token = await getAccessToken(config, opts);
  const fetchImpl = opts.fetchImpl || fetch;
  const res = await fetchImpl(`${API}/freeBusy`, {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify({ timeMin, timeMax, items: [{ id: calendarId }] }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.error?.message || `HTTP ${res.status}`);

  const busy = (data.calendars?.[calendarId]?.busy || [])
    .map((b) => [Date.parse(b.start), Date.parse(b.end)])
    .filter(([s, e]) => Number.isFinite(s) && Number.isFinite(e))
    .sort((a, b) => a[0] - b[0]);

  const needed = minutes * 60_000;
  const slots = [];
  let cursor = Date.parse(timeMin);
  const end = Date.parse(timeMax);

  for (const [bStart, bEnd] of busy) {
    if (bStart - cursor >= needed) {
      slots.push({ start: new Date(cursor).toISOString(), end: new Date(bStart).toISOString() });
      if (slots.length >= limit) return slots;
    }
    cursor = Math.max(cursor, bEnd);
  }
  if (end - cursor >= needed) {
    slots.push({ start: new Date(cursor).toISOString(), end: new Date(end).toISOString() });
  }
  return slots.slice(0, limit);
}

// ─── plugin lifecycle ───────────────────────────────────────────────────────

function asBool(v, fallback = false) {
  if (v === undefined || v === null) return fallback;
  return v === true || v === "true" || v === "on" || v === 1 || v === "1";
}

export const calendarPlugin = {
  slug: "calendar",
  name: "Google Calendar",
  type: "calendar",
  description:
    "Conectá tu Google Calendar con una service account para que los agentes lean tu agenda y agenden",
  auth: "service_account",
  tools: [
    { slug: "calendar_list_events", desc: "Ver qué hay en la agenda" },
    { slug: "calendar_find_slot", desc: "Buscar huecos libres" },
    { slug: "calendar_create_event", desc: "Agendar un evento" },
    { slug: "calendar_update_event", desc: "Mover o editar un evento" },
  ],
  // Structure only — display text lives in web i18n (integrations.calendar.*).
  ui: {
    accent: "sky",
    configFields: [
      {
        key: "key_file",
        type: "path",
        placeholder: "~/Downloads/mi-proyecto-a1b2c3.json",
        help_url: "https://console.cloud.google.com/iam-admin/serviceaccounts",
        help_url_label: "console.cloud.google.com",
      },
      { key: "service_account_json", type: "password", placeholder: '{"type":"service_account",…}' },
      { key: "write_access", type: "toggle", default: false },
    ],
    select: { key: "calendar_id", action: "calendars", listKey: "calendars", valueKey: "id", labelKey: "summary" },
    connectedFields: ["client_email", "calendar_name", "access_role"],
  },

  configure(record, body = {}) {
    const prev = record?.config || {};
    const keyFile = String(body.key_file ?? prev.key_file ?? "").trim();
    const pasted = String(body.service_account_json ?? prev.service_account_json ?? "").trim();
    const calendarId = String(body.calendar_id ?? prev.calendar_id ?? "").trim();

    if (!keyFile && !pasted && !calendarId) {
      throw new Error("Provide the service account key (a file path or the JSON itself)");
    }

    const config = {
      ...(keyFile ? { key_file: keyFile } : {}),
      ...(pasted ? { service_account_json: pasted } : {}),
      ...(calendarId ? { calendar_id: calendarId } : {}),
      write_access: asBool(body.write_access, prev.write_access ?? false),
    };

    const patch = {
      name: this.name,
      type: this.type,
      description: this.description,
      config,
    };
    // A new key, or a different scope, is a connection nobody has verified yet.
    if (keyFile || pasted || config.write_access !== prev.write_access) {
      patch.status = "pending_validation";
    }
    return { patch };
  },

  async validate(record) {
    const config = record?.config || {};
    let key;
    try {
      key = readKey(config);
    } catch (e) {
      return {
        patch: { status: "error", is_enabled: false, config: { last_error: String(e.message || e) } },
        result: { ok: false, error: String(e.message || e) },
      };
    }

    let calendars;
    try {
      calendars = await listCalendars(config);
    } catch (e) {
      return {
        patch: { status: "error", is_enabled: false, config: { last_error: String(e.message || e) } },
        result: { ok: false, error: String(e.message || e) },
      };
    }

    // A key that works but sees nothing means one specific thing, and saying it
    // is the difference between a two-minute fix and an afternoon.
    if (!calendars.length) {
      const detail =
        `The key works, but no calendar is shared with ${key.client_email}. ` +
        `In Google Calendar → Settings → your calendar → "Share with specific people", add that address.`;
      return {
        patch: { status: "error", is_enabled: false, config: { client_email: key.client_email, last_error: detail } },
        result: { ok: false, error: detail, client_email: key.client_email },
      };
    }

    // Auto-select when there is nothing to choose between — same rule as Asana
    // with a single workspace.
    const chosen =
      calendars.find((c) => c.id === config.calendar_id) ||
      (calendars.length === 1 ? calendars[0] : null);

    return {
      patch: {
        status: "active",
        is_enabled: true,
        config: {
          client_email: key.client_email,
          ...(chosen ? { calendar_id: chosen.id, calendar_name: chosen.summary, access_role: chosen.accessRole } : {}),
          last_error: null,
        },
      },
      result: { ok: true, client_email: key.client_email, calendars, calendar_id: chosen?.id || null },
    };
  },

  status(record) {
    const c = record?.config || {};
    return {
      slug: this.slug,
      status: record?.status || "disconnected",
      is_enabled: !!record?.is_enabled,
      client_email: c.client_email || null,
      calendar_id: c.calendar_id || null,
      calendar_name: c.calendar_name || null,
      access_role: c.access_role || null,
      write_access: !!c.write_access,
    };
  },

  deactivate() {
    return { patch: { status: "inactive", is_enabled: false } };
  },

  actions: {
    async calendars(record) {
      return { calendars: await listCalendars(record?.config || {}) };
    },
  },
};

export default calendarPlugin;
