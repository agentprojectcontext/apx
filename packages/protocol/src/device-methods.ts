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

export const deviceMethods = {
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
  "devices.revoke": {
    params: z.object({ id: Id }).strict(),
    result: z.object({ revoked: z.boolean() }),
    effect: true,
    access: "human",
  },
} as const;
