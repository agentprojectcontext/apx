// Wire frames. Every transport (WS, HTTP /rpc, node link) carries exactly these shapes.
// Isomorphic: no Node-only imports in this package — it runs in browsers, Electron and React Native too.
import { z } from "zod";

export const PROTOCOL_VERSION = 1;

export const ErrorCode = {
  BadRequest: "bad_request",
  UnknownMethod: "unknown_method",
  Unauthorized: "unauthorized",
  Unavailable: "unavailable",
  Timeout: "timeout",
  Internal: "internal",
} as const;
export type ErrorCode = (typeof ErrorCode)[keyof typeof ErrorCode];

export const ApxErrorShape = z.object({
  code: z.enum(Object.values(ErrorCode) as [ErrorCode, ...ErrorCode[]]),
  message: z.string(),
  detail: z.unknown().optional(),
});
export type ApxErrorShape = z.infer<typeof ApxErrorShape>;

export const ClientRole = z.enum(["operator", "node"]);
export type ClientRole = z.infer<typeof ClientRole>;

/** First frame a client sends on a socket. Device signing lands with pairing (F6). */
export const HelloFrame = z.object({
  t: z.literal("hello"),
  protocol: z.number().int(),
  client: z.object({ name: z.string(), version: z.string() }),
  role: ClientRole,
  /** Capabilities a node offers (e.g. "browser", "fs", "notify"). Empty for operators. */
  caps: z.array(z.string()).default([]),
});
export type HelloFrame = z.infer<typeof HelloFrame>;

export const WelcomeFrame = z.object({
  t: z.literal("welcome"),
  protocol: z.number().int(),
  session: z.string(),
  server: z.object({ version: z.string(), code_sha: z.string() }),
});
export type WelcomeFrame = z.infer<typeof WelcomeFrame>;

export const ReqFrame = z.object({
  t: z.literal("req"),
  id: z.string().min(1),
  method: z.string().min(1),
  params: z.unknown().optional(),
  /** Required by methods with side effects; the server dedupes on it. */
  idem: z.string().optional(),
});
export type ReqFrame = z.infer<typeof ReqFrame>;

export const ResFrame = z.discriminatedUnion("ok", [
  z.object({ t: z.literal("res"), id: z.string(), ok: z.literal(true), result: z.unknown() }),
  z.object({ t: z.literal("res"), id: z.string(), ok: z.literal(false), error: ApxErrorShape }),
]);
export type ResFrame = z.infer<typeof ResFrame>;

/** Server → client push. `seq` is per stream; a gap means "refetch", never "replay". */
export const EventFrame = z.object({
  t: z.literal("event"),
  stream: z.string(),
  seq: z.number().int().nonnegative(),
  type: z.string(),
  payload: z.unknown(),
});
export type EventFrame = z.infer<typeof EventFrame>;

export const ClientFrame = z.discriminatedUnion("t", [HelloFrame, ReqFrame]);
export type ClientFrame = z.infer<typeof ClientFrame>;
export const ServerFrame = z.discriminatedUnion("t", [WelcomeFrame, ResFrame, EventFrame]);
export type ServerFrame = z.infer<typeof ServerFrame>;
