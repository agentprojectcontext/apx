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
});
export type Device = z.infer<typeof Device>;

export const deviceMethods = {
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
  "devices.revoke": {
    params: z.object({ id: Id }).strict(),
    result: z.object({ revoked: z.boolean() }),
    effect: true,
    access: "human",
  },
} as const;
