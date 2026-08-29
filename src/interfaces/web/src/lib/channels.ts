// Channels, as THIS DEVICE wants them.
//
// One agent is reachable from several places at once, and the inbox now shows
// every one of them. That is right for the list and wrong for the bell: the
// phone has Telegram installed ON it, so a Telegram reply announced by APX is
// the same event announced twice, while the same reply on the laptop is the
// only way to hear about it at all. There is no single correct answer, so the
// question is asked per device.
//
// Two independent axes, deliberately not one setting:
//   VIEW   — whose conversations appear in the lists (inbox, phone).
//   NOTIFY — who is allowed to raise a notification.
// Hiding Telegram threads from the phone list and still wanting a bell for them
// is a coherent position; so is the reverse.
//
// Stored in localStorage because that IS the scope of the question — per
// origin, per device, and untouched by another browser signing in. Only
// EXPLICIT choices are stored: an absent channel falls through to the default
// for the surface, so a channel invented after this code shipped behaves
// sensibly instead of being silently muted.
import { isInstalled } from "./net";
import { t } from "../i18n";

export type ChannelAxis = "view" | "notify";

const KEYS: Record<ChannelAxis, string> = {
  view: "apx.channels.view",
  notify: "apx.channels.notify",
};

/** Proper nouns, mostly, so they read the same in either locale. The two that
 *  are descriptions rather than names go through i18n. Anything unknown shows
 *  its raw value rather than being hidden — a channel nobody named is exactly
 *  the one worth seeing. */
const CHANNEL_LABELS: Record<string, string> = {
  whatsapp: "WhatsApp",
  telegram: "Telegram",
  web: "Web",
  web_sidebar: "Web · sidebar",
  web_code: "Web · code",
  desktop: "Desktop",
  deck: "Deck",
  code: "Code",
  cli: "CLI",
  api: "API",
  direct: "Direct",
  routine: "Routine",
};

export function channelLabel(channel: string): string {
  if (channel === "a2a") return t("channels.a2a");
  if (channel === "group") return t("channels.group");
  if (channel === "other") return t("channels.other");
  return CHANNEL_LABELS[channel] || channel;
}

/**
 * Is this the phone shell, rather than the panel?
 *
 * Installed counts (the APK and an installed PWA both open at /mobile), and so
 * does simply being on the phone route in a browser. It decides two things: the
 * shape of the URL a notification tap lands on, and which channels are muted
 * out of the box.
 */
export function isPhoneSurface(): boolean {
  if (isInstalled()) return true;
  return typeof location !== "undefined" && location.pathname.startsWith("/mobile");
}

/**
 * Channels that start OFF on the phone.
 *
 * Telegram, and only Telegram: the app is on the same device, so its own
 * notification has already arrived and its own thread is one home-screen icon
 * away. Everything else is a place the phone cannot otherwise reach. One tap on
 * the chip turns it back on, per axis, and that choice is then remembered
 * instead of falling back here.
 */
const PHONE_MUTED = new Set(["telegram"]);

export function channelDefault(_axis: ChannelAxis, channel: string): boolean {
  return !(isPhoneSurface() && PHONE_MUTED.has(channel));
}

/** The explicit choices on one axis. Absent channels are NOT in here. */
export function channelPrefs(axis: ChannelAxis): Record<string, boolean> {
  try {
    const raw = localStorage.getItem(KEYS[axis]);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    const out: Record<string, boolean> = {};
    for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof v === "boolean") out[k] = v;
    }
    return out;
  } catch {
    return {}; // private mode, or something else wrote over the key
  }
}

/** The same answer, against a map already in hand — what a React render has,
 *  and what keeps a memo dependent on a stable value instead of a closure
 *  rebuilt every render. */
export function channelEnabledIn(
  prefs: Record<string, boolean>,
  axis: ChannelAxis,
  channel: string | null | undefined,
): boolean {
  const key = channel || "other";
  const explicit = prefs[key];
  return explicit === undefined ? channelDefault(axis, key) : explicit;
}

/** Should this channel be shown / announced on this device right now? */
export function channelEnabled(axis: ChannelAxis, channel: string | null | undefined): boolean {
  return channelEnabledIn(channelPrefs(axis), axis, channel);
}

/** Remember a choice. Listeners (the chips, the notifier) hear about it through
 *  the event below rather than by polling storage. */
export function setChannelEnabled(axis: ChannelAxis, channel: string, on: boolean) {
  const next = { ...channelPrefs(axis), [channel]: on };
  try {
    localStorage.setItem(KEYS[axis], JSON.stringify(next));
  } catch {
    /* private mode: it holds for this session, which is all we can offer */
  }
  emitChange(axis);
}

// A same-tab change fires nothing on its own — `storage` only reaches OTHER
// tabs — so the chips and the notifier would keep rendering the old answer
// until something else re-rendered them.
const CHANGE_EVENT = "apx:channel-prefs";

function emitChange(axis: ChannelAxis) {
  try {
    window.dispatchEvent(new CustomEvent(CHANGE_EVENT, { detail: { axis } }));
  } catch {
    /* no window (SSR, a test): nothing is listening anyway */
  }
}

/** Subscribe to preference changes, from this tab or another one. */
export function onChannelPrefsChange(fn: () => void): () => void {
  const local = () => fn();
  const remote = (e: StorageEvent) => {
    if (!e.key || e.key === KEYS.view || e.key === KEYS.notify) fn();
  };
  window.addEventListener(CHANGE_EVENT, local);
  window.addEventListener("storage", remote);
  return () => {
    window.removeEventListener(CHANGE_EVENT, local);
    window.removeEventListener("storage", remote);
  };
}

/** The channels present in a set of rows, most recent first (rows arrive
 *  sorted), so a filter strip offers what actually exists on this install
 *  rather than a hardcoded catalog of everything APX can speak. */
export function channelsOf(rows: { channel: string | null }[]): string[] {
  const seen: string[] = [];
  for (const row of rows) {
    const key = row.channel || "other";
    if (!seen.includes(key)) seen.push(key);
  }
  return seen;
}
