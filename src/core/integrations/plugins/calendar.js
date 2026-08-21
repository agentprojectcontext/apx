// Google Calendar integration plugin — user OAuth, so an agent can act AS you.
//
// This plugin used to authenticate with a service account: paste a JSON key,
// share your calendar with a robot email, done. It worked for reading and for
// creating plain events, but a service account acts as ITSELF, and Google bars
// it from inviting other people or creating a Meet link without Domain-Wide
// Delegation — a Workspace feature a personal @gmail.com does not have. So
// "agendá con Carlos y mandale el Meet" was simply impossible.
//
// User OAuth acts as YOU. You consent once in the browser and Google hands back
// a refresh token; from then on APX reads your agenda, creates and moves events,
// SENDS INVITATIONS, and creates Meet links — because it is you doing it, on your
// own calendar. The only setup left is a one-time OAuth client in Google Cloud
// Console (client_id + secret). No key file, no calendar sharing, no Workspace.
//
// The OAuth mechanics (consent URL, code exchange, refresh, state signing) live
// in ./_google-oauth.js. This file is the calendar REST client + the plugin
// lifecycle the daemon and web panel drive.
import crypto from "node:crypto";
import {
  buildAuthUrl,
  callbackUrl,
  signState,
  exchangeCode,
  accessTokenFor,
} from "./_google-oauth.js";

const API = "https://www.googleapis.com/calendar/v3";

// Full calendar when the owner allows writes (create/move events, invite people,
// mint Meet links, free/busy); read-only otherwise. `openid email` rides along
// so we can show which account is connected. Kept broad-but-standard on purpose:
// narrower per-feature scopes make invites and free/busy fragile for no real gain
// on a single-user tool.
export const SCOPE_READ = "openid email https://www.googleapis.com/auth/calendar.readonly";
export const SCOPE_WRITE = "openid email https://www.googleapis.com/auth/calendar";

function scopeFor(config) {
  return config?.write_access ? SCOPE_WRITE : SCOPE_READ;
}

// ─── access tokens ────────────────────────────────────────────────────────────

/** A live access token for the stored connection, or a clear error. */
export async function getAccessToken(config = {}, opts = {}) {
  const { client_id, client_secret, refresh_token } = config || {};
  if (!client_id || !client_secret) {
    throw new Error("Falta el OAuth client (client_id / client_secret). Cargalos en el panel.");
  }
  if (!refresh_token) {
    throw new Error("El calendario no está autorizado todavía. Conectá con Google en el panel.");
  }
  return accessTokenFor({ clientId: client_id, clientSecret: client_secret, refreshToken: refresh_token }, opts);
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
    if (res.status === 401 || res.status === 403) {
      throw new Error(`${msg} — puede que haga falta reconectar con Google en el panel.`);
    }
    throw new Error(msg);
  }
  return data;
}

/** Calendars the connected account can see — used only for the account probe. */
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
    meet_link: e.hangoutLink || null,
  };
}

export async function listEvents(config, { calendarId = "primary", timeMin, timeMax, q, maxResults = 25 } = {}, opts = {}) {
  const data = await call(config, `/calendars/${encodeURIComponent(calendarId)}/events`, {
    query: { timeMin, timeMax, q, maxResults, singleEvents: true, orderBy: "startTime" },
    ...opts,
  });
  return (data.items || []).map(flattenEvent);
}

/**
 * Create an event. Because we act as the user now, two things that were
 * impossible with a service account just work:
 *   - attendees get a real invitation (`sendUpdates=all`)
 *   - `meet: true` mints a Google Meet link (`conferenceData` + v1)
 */
export async function createEvent(
  config,
  { calendarId = "primary", title, start, end, description, location, attendees, meet = false } = {},
  opts = {},
) {
  const hasAttendees = Array.isArray(attendees) && attendees.length > 0;
  const body = {
    summary: title,
    description: description || undefined,
    location: location || undefined,
    start: { dateTime: start },
    end: { dateTime: end },
    ...(hasAttendees ? { attendees: attendees.map((email) => ({ email })) } : {}),
    ...(meet
      ? {
          conferenceData: {
            createRequest: {
              requestId: crypto.randomUUID(),
              conferenceSolutionKey: { type: "hangoutsMeet" },
            },
          },
        }
      : {}),
  };
  const data = await call(config, `/calendars/${encodeURIComponent(calendarId)}/events`, {
    method: "POST",
    body,
    query: {
      ...(meet ? { conferenceDataVersion: 1 } : {}),
      ...(hasAttendees ? { sendUpdates: "all" } : {}),
    },
    ...opts,
  });
  return flattenEvent(data);
}

export async function updateEvent(config, { calendarId = "primary", eventId, ...fields } = {}, opts = {}) {
  const body = {};
  if (fields.title !== undefined) body.summary = fields.title;
  if (fields.description !== undefined) body.description = fields.description;
  if (fields.location !== undefined) body.location = fields.location;
  if (fields.start !== undefined) body.start = { dateTime: fields.start };
  if (fields.end !== undefined) body.end = { dateTime: fields.end };
  const hasAttendees = Array.isArray(fields.attendees) && fields.attendees.length > 0;
  if (fields.attendees !== undefined) body.attendees = (fields.attendees || []).map((email) => ({ email }));
  const data = await call(config, `/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}`, {
    method: "PATCH",
    body,
    query: { ...(hasAttendees ? { sendUpdates: "all" } : {}) },
    ...opts,
  });
  return flattenEvent(data);
}

/**
 * The first gaps of at least `minutes` between timeMin and timeMax, from
 * Google's freeBusy view. Pure arithmetic once the busy blocks are in.
 */
export async function findSlots(config, { calendarId = "primary", timeMin, timeMax, minutes = 30, limit = 5 } = {}, opts = {}) {
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
    "Conectá tu Google Calendar con OAuth para que los agentes lean tu agenda, agenden, inviten y armen Meet",
  auth: "oauth",
  tools: [
    { slug: "calendar_list_events", desc: "Ver qué hay en la agenda" },
    { slug: "calendar_find_slot", desc: "Buscar huecos libres" },
    { slug: "calendar_create_event", desc: "Agendar un evento (con invitados y Meet)" },
    { slug: "calendar_update_event", desc: "Mover o editar un evento" },
  ],
  // Structure only — display text lives in web i18n (integrations.calendar.*).
  ui: {
    accent: "sky",
    // Presence of `oauth` tells the web component to run the consent flow:
    // save client_id/secret, then a "Conectar con Google" button. `redirectPath`
    // is the URI the user registers in the console (shown in the UI).
    oauth: { action: "authorize", redirectPath: "/api/integrations/oauth/callback" },
    configFields: [
      {
        key: "client_id",
        type: "text",
        placeholder: "123-abc.apps.googleusercontent.com",
        help_url: "https://console.cloud.google.com/apis/credentials",
        help_url_label: "console.cloud.google.com",
      },
      { key: "client_secret", type: "password", placeholder: "GOCSPX-…" },
      { key: "write_access", type: "toggle", default: true },
      { key: "meet", type: "toggle", default: true },
    ],
    connectedFields: ["account_email", "calendar_name"],
  },

  // Save the OAuth client + preferences. This never mints tokens — authorization
  // happens in the browser (authorize action → callback → completeOAuth).
  configure(record, body = {}) {
    const prev = record?.config || {};
    const clientId = String(body.client_id ?? prev.client_id ?? "").trim();
    const clientSecret = String(body.client_secret ?? prev.client_secret ?? "").trim();

    // A live connection flipping a preference (write/meet) shouldn't need the
    // secret re-typed — merge over what's stored.
    const config = {
      ...(clientId ? { client_id: clientId } : {}),
      ...(clientSecret ? { client_secret: clientSecret } : {}),
      write_access: asBool(body.write_access, prev.write_access ?? true),
      meet: asBool(body.meet, prev.meet ?? true),
    };

    if (!clientId && !prev.client_id) {
      throw new Error("Cargá el client_id del OAuth client de Google.");
    }

    const patch = { name: this.name, type: this.type, description: this.description, config };
    // A changed write scope needs a re-consent (the granted scope no longer
    // matches). Everything else keeps the current connection.
    if (config.write_access !== prev.write_access && prev.refresh_token) {
      patch.status = "pending_validation";
      patch.config.needs_reauth = true;
    }
    return { patch };
  },

  /**
   * Build the Google consent URL. Called by the web panel (authorize action);
   * `ctx.origin` is the browser origin, so the redirect URI matches what the
   * user registered and what the callback reconstructs.
   */
  buildAuthorizeUrl(record, { origin, pid, scope } = {}) {
    const config = record?.config || {};
    if (!config.client_id) throw new Error("Cargá primero el client_id.");
    if (!origin) throw new Error("No pude determinar el origin del panel para el redirect.");
    const redirectUri = callbackUrl(origin);
    const state = signState({ slug: this.slug, pid: String(pid ?? ""), scope: scope || "project" });
    const auth_url = buildAuthUrl({
      clientId: config.client_id,
      redirectUri,
      scope: scopeFor(config),
      state,
    });
    return { auth_url, redirect_uri: redirectUri };
  },

  /**
   * Finish the OAuth dance: trade the code for a refresh token and activate.
   * Called by the daemon's callback route. Returns a patch to persist.
   */
  async completeOAuth(record, { code, redirectUri } = {}) {
    const config = record?.config || {};
    if (!config.client_id || !config.client_secret) {
      throw new Error("Falta el OAuth client guardado para completar la conexión.");
    }
    const tokens = await exchangeCode({
      clientId: config.client_id,
      clientSecret: config.client_secret,
      code,
      redirectUri,
    });
    return {
      patch: {
        status: "active",
        is_enabled: true,
        config: {
          refresh_token: tokens.refresh_token,
          account_email: tokens.email || config.account_email || null,
          calendar_id: "primary",
          calendar_name: tokens.email || "primary",
          needs_reauth: false,
          last_error: null,
        },
      },
    };
  },

  // Re-check a stored connection (used when flipping toggles once connected).
  async validate(record) {
    const config = record?.config || {};
    if (!config.refresh_token) {
      const detail = "Autorizá con Google en el panel para conectar el calendario.";
      return {
        patch: { status: "pending_validation", is_enabled: false, config: { last_error: detail } },
        result: { ok: false, error: detail, needs_auth: true },
      };
    }
    try {
      // A cheap call that proves the refresh token still works.
      await call(config, "/users/me/calendarList", { query: { maxResults: 1 } });
    } catch (e) {
      return {
        patch: { status: "error", is_enabled: false, config: { last_error: String(e.message || e) } },
        result: { ok: false, error: String(e.message || e) },
      };
    }
    return {
      patch: { status: "active", is_enabled: true, config: { calendar_id: "primary", needs_reauth: false, last_error: null } },
      result: { ok: true, account_email: config.account_email || null },
    };
  },

  status(record) {
    const c = record?.config || {};
    // No refresh token → not connected, whatever the stored status says. This
    // also demotes a leftover service-account record from the old auth model so
    // it can't masquerade as "active" after the OAuth migration.
    const authorized = !!c.refresh_token;
    let st = record?.status || "disconnected";
    if (!authorized && st === "active") st = "disconnected";
    return {
      slug: this.slug,
      status: st,
      is_enabled: authorized && !!record?.is_enabled,
      account_email: c.account_email || null,
      calendar_id: c.calendar_id || (c.refresh_token ? "primary" : null),
      calendar_name: c.calendar_name || (c.refresh_token ? c.account_email || "primary" : null),
      write_access: !!c.write_access,
      meet: !!c.meet,
      client_id_set: !!c.client_id,
      needs_reauth: !!c.needs_reauth,
    };
  },

  deactivate() {
    return { patch: { status: "inactive", is_enabled: false } };
  },

  actions: {
    // Kick off OAuth: the web panel opens the returned auth_url in a popup.
    async authorize(record, ctx = {}) {
      return calendarPlugin.buildAuthorizeUrl(record, {
        origin: ctx.origin,
        pid: ctx.project?.id ?? 0,
        scope: ctx.scope,
      });
    },
  },
};

export default calendarPlugin;
