// The owner's own devices (a phone, another computer): paired once with a short code shown as a QR in the panel, then
// each one talks to the core with a token of its own, which the owner can revoke without touching the others.
import { z } from "zod";
import { Id } from "./domain.ts";

export const DevicePlatform = z.enum(["ios", "android", "desktop", "other"]);
export type DevicePlatform = z.infer<typeof DevicePlatform>;

export const Device = z.object({
  id: Id,
  name: z.string(),
  platform: DevicePlatform,
  created_at: z.string(),
  last_seen_at: z.string().optional(),
  /** How notices reach it when the app is closed (the token or address itself is never shown back). */
  push: z.enum(["expo", "unifiedpush"]).optional(),
});
export type Device = z.infer<typeof Device>;

/** Where a device takes push notices: an Expo push token, or a UnifiedPush / ntfy address (any https URL). */
export const PushTarget = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("expo"), token: z.string().regex(/^Expo(nent)?PushToken\[[\w-]+\]$/) }),
  z.object({ kind: z.literal("unifiedpush"), endpoint: z.string().url().max(2000).startsWith("https://") }),
]);
export type PushTarget = z.infer<typeof PushTarget>;

/** What a phone lends the core as a node: where it is, and its camera (the owner takes the picture). */
export const PHONE_LOCATION_CAP = "location";
export const PHONE_CAMERA_CAP = "camera";
/**
 * What the desktop lends when the owner turned computer use on there: looking at the screen and acting on the window
 * in front. Off unless the owner opts in on that computer.
 */
export const COMPUTER_CAP = "computer";

export const AccessMode = z.enum(["local", "lan", "tailscale"]);
export type AccessMode = z.infer<typeof AccessMode>;
export const AccessState = z.object({
  /** What this running core does now; `saved` is what it takes on its next start. */
  mode: AccessMode,
  saved: AccessMode,
  restart_needed: z.boolean(),
  /** Where other devices reach it now (empty: only this computer). */
  urls: z.array(z.string()),
  token_set: z.boolean(),
  tailscale: z.object({ installed: z.boolean(), connected: z.boolean(), url: z.string().optional() }),
});
export type AccessState = z.infer<typeof AccessState>;

/**
 * The public address platforms that deliver to a webhook (Teams, LINE) reach this core on: off, Tailscale Funnel, an
 * ngrok tunnel, or the owner's own (a proxy they run). It publishes only the webhook listener. See DECISIONS.md#d-139
 */
export const HookMode = z.enum(["off", "tailscale", "ngrok", "custom"]);
export type HookMode = z.infer<typeof HookMode>;
/** Why the public address is not up; the panel says each in the owner's language. */
export const HookError = z.enum([
  "tailscale_missing",
  "tailscale_offline",
  "funnel_failed",
  "ngrok_missing",
  "ngrok_timeout",
  "ngrok_failed",
  "ngrok_stopped",
  "failed",
]);
export type HookError = z.infer<typeof HookError>;
export const WebhooksState = z.object({
  mode: HookMode,
  /** The base platforms reach, as `<url>/hooks/<channel id>`; none while off or not up yet. */
  url: z.string().optional(),
  /**
   * ngrok gave an address it had not given before (the first one, or another after it started again): the owner pastes
   * it into the platform. A free account usually keeps one address, so this is said only when it is new.
   */
  url_may_change: z.boolean(),
  /** The loopback port of the webhook listener (what Funnel or ngrok forwards to). */
  port: z.number(),
  /** The owner's reserved ngrok domain, when they gave one. */
  domain: z.string().optional(),
  /** Why the address is not up (Funnel not allowed in the tailnet, ngrok not signed in…). */
  error: HookError.optional(),
  /** What the tool itself said, when it said something (ngrok's own error line, an exit code). */
  error_detail: z.string().optional(),
  tailscale: z.object({ installed: z.boolean(), connected: z.boolean() }),
  ngrok: z.object({ installed: z.boolean() }),
});
export type WebhooksState = z.infer<typeof WebhooksState>;

export const deviceMethods = {
  /** The public address for channels' webhooks, and what this computer has to make one. */
  "webhooks.get": {
    params: z.object({}).strict(),
    result: WebhooksState,
    effect: false,
    access: "human",
  },
  /** Turns the public address on (by Funnel, ngrok or the owner's own URL) or off. */
  "webhooks.set": {
    params: z
      .object({
        mode: HookMode,
        /** `custom`: the owner's public base URL (https). */
        url: z.string().trim().url().max(300).optional(),
        /** `ngrok`: a reserved domain (example.ngrok.app), so the address survives restarts. */
        domain: z.string().trim().max(200).optional(),
      })
      .strict(),
    result: WebhooksState,
    effect: true,
    access: "human",
  },
  /** Who may reach this core: this computer only, the local network, or the owner's tailnet (Tailscale). */
  "access.get": {
    params: z.object({}).strict(),
    result: AccessState,
    effect: false,
    access: "human",
  },
  /** Saves who may reach the core; a supervised core restarts to take it (`restarting`). */
  "access.set": {
    params: z.object({ mode: AccessMode }).strict(),
    result: AccessState.extend({ restarting: z.boolean() }),
    effect: true,
    access: "human",
  },
  /**
   * A one-time code (10 minutes) for the next device, and the addresses it may reach this core on. None when the core
   * listens only on this computer: a phone cannot reach it then.
   */
  "devices.pair_start": {
    params: z.object({}).strict(),
    result: z.object({ code: z.string(), expires_at: z.string(), urls: z.array(z.string()) }),
    effect: true,
    access: "human",
    replay: false,
  },
  /** Cancels a pending code: closing the QR also makes that code unusable. */
  "devices.pair_cancel": {
    params: z.object({ code: z.string().trim().min(6).max(16) }).strict(),
    result: z.object({ canceled: z.boolean() }),
    effect: true,
    access: "human",
  },
  /** A device trades the code for its own token (shown once). Callable without the core's token: the code is the key. */
  "devices.pair": {
    params: z
      .object({
        code: z.string().trim().min(6).max(16),
        name: z.string().trim().min(1).max(60),
        platform: DevicePlatform.default("other"),
      })
      .strict(),
    result: z.object({ device: Device, token: z.string() }),
    effect: true,
    open: true,
    replay: false,
  },
  "devices.list": {
    params: z.object({}).strict(),
    result: z.object({ devices: z.array(Device) }),
    effect: false,
    access: "human",
  },
  /**
   * Where a device takes push notices (null: none). A device sets its own; the owner (from the panel) names one. Pick
   * it as the place notices go in Interruptions.
   */
  "devices.set_push": {
    params: z.object({ id: Id.optional(), push: PushTarget.nullable() }).strict(),
    result: Device,
    effect: true,
  },
  /** The owner's phone, as a node: where it is now. */
  "phone.location": {
    params: z.object({}).strict(),
    result: z.object({ lat: z.number(), lon: z.number(), accuracy_m: z.number().optional(), at: z.string() }),
    effect: false,
  },
  /** The owner's phone, as a node: a picture the owner takes there (the app asks them); it is kept as media. */
  "phone.photo": {
    params: z.object({ reason: z.string().max(200).optional(), thread: Id.optional() }).strict(),
    result: z.object({ media: z.object({ id: Id, mime: z.string() }) }),
    effect: true,
  },
  /**
   * The desktop, as a node: a picture of the screen (kept as media), the app and window in front, and what that window
   * shows as accessible elements (buttons, toggles, fields, with their values).
   */
  "computer.snapshot": {
    /** `app`: bring that app to the front first (its window is the one seen). */
    params: z
      .object({
        thread: Id.optional(),
        app: z.string().min(1).max(120).optional(),
        note: z.string().max(80).optional(),
      })
      .strict(),
    result: z.object({
      media: z.object({ id: Id, mime: z.string() }),
      app: z.string(),
      window: z.string(),
      elements: z.string(),
    }),
    effect: true,
  },
  /**
   * A click at a point of the screen (screen points: a monitor left of or above the main one has negative ones), only if `app` is still the app in front (the owner approved it for that app):
   * otherwise nothing happens and the call fails.
   */
  "computer.click": {
    params: z
      .object({
        x: z.number().int().min(-20_000).max(20_000),
        y: z.number().int().min(-20_000).max(20_000),
        app: z.string().min(1).max(120),
        /** What the agent is doing, in a few words: shown beside its pointer on the owner's screen. */
        note: z.string().max(80).optional(),
      })
      .strict(),
    result: z.object({
      app: z.string(),
      /** What it did there: pressed or focused which element, or a real click. */
      how: z.string().optional(),
    }),
    effect: true,
  },
  /** Types text into the focused field of `app`, never into a password field. */
  "computer.type": {
    params: z
      .object({
        text: z.string().min(1).max(2000),
        app: z.string().min(1).max(120),
        note: z.string().max(80).optional(),
      })
      .strict(),
    result: z.object({ app: z.string() }),
    effect: true,
  },
  /**
   * Presses keys in `app` (brought to the front): "enter", "tab", "esc", "cmd+l", "cmd+t", "cmd+shift+r", arrows…
   * Quitting, closing windows and logging out are refused.
   */
  "computer.key": {
    params: z
      .object({ keys: z.string().min(1).max(40), app: z.string().min(1).max(120), note: z.string().max(80).optional() })
      .strict(),
    result: z.object({ app: z.string() }),
    effect: true,
  },
  /** Opens a web address (in `app`, a browser, as a new tab; else the default one) or an app, straight away. */
  "computer.open": {
    params: z
      .object({
        url: z.string().url().max(2000).optional(),
        app: z.string().min(1).max(120).optional(),
        note: z.string().max(80).optional(),
      })
      .strict(),
    result: z.object({
      app: z.string(),
      /** Where its window came up: which of the owner's screens, and its bounds. */
      where: z.string().optional(),
    }),
    effect: true,
  },
  "devices.revoke": {
    params: z.object({ id: Id }).strict(),
    result: z.object({ revoked: z.boolean() }),
    effect: true,
    access: "human",
  },
} as const;
