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
  /** The user took control of the resource (e.g. a browser tab); retry later or ask. */
  PausedByUser: "paused_by_user",
  /** The action would type into a password/OTP/card field: hand off to the human. */
  CredentialField: "credential_field",
  /** The state moved on (answered already, expired): re-read before acting. */
  Conflict: "conflict",
  Internal: "internal",
} as const;
export type ErrorCode = (typeof ErrorCode)[keyof typeof ErrorCode];

export const ApxErrorShape = z.object({
  code: z.enum(Object.values(ErrorCode) as [ErrorCode, ...ErrorCode[]]),
  message: z.string(),
  detail: z.unknown().optional(),
  /** true → the same call may succeed later (timeout, node offline); false or absent → do not retry as is. */
  retryable: z.boolean().optional(),
});
export type ApxErrorShape = z.infer<typeof ApxErrorShape>;

export const ClientRole = z.enum(["operator", "node"]);
export type ClientRole = z.infer<typeof ClientRole>;

/**
 * Who is behind an operator connection. An agent client (e.g. `apx2 mcp` used by another tool) never gets the
 * human's controls. Self-declared on loopback; scoped tokens replace it when pairing lands.
 */
export const Actor = z.enum(["human", "agent"]);
export type Actor = z.infer<typeof Actor>;

/** First frame a client sends on a socket. Device signing lands with pairing (F6). */
export const HelloFrame = z.object({
  t: z.literal("hello"),
  protocol: z.number().int(),
  client: z.object({ name: z.string(), version: z.string() }),
  role: ClientRole,
  /** Capabilities a node offers (e.g. "browser", "fs", "notify"). Empty for operators. */
  caps: z.array(z.string()).default([]),
  actor: Actor.default("human"),
});
export type HelloFrame = z.infer<typeof HelloFrame>;

export const WelcomeFrame = z.object({
  t: z.literal("welcome"),
  protocol: z.number().int(),
  session: z.string(),
  server: z.object({ version: z.string(), code_sha: z.string() }),
  /** What this connection may call: the client does not guess. */
  methods: z.array(z.string()).default([]),
  limits: z.object({ max_payload: z.number().int() }).optional(),
  auth: z.object({ role: ClientRole, actor: Actor }).optional(),
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

// Both directions carry req/res: operators call the core; the core calls nodes (role "node").
export const ClientFrame = z.union([HelloFrame, ReqFrame, ResFrame, EventFrame]);
export type ClientFrame = z.infer<typeof ClientFrame>;
export const ServerFrame = z.union([WelcomeFrame, ReqFrame, ResFrame, EventFrame]);
export type ServerFrame = z.infer<typeof ServerFrame>;
