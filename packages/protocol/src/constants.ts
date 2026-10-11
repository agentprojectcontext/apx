// Plain values every client may need, with no zod: the browser imports these through `@apx/protocol/client`
// and never loads the schema registry (the core validates; see client.ts).

export const PROTOCOL_VERSION = 1;

export const ErrorCode = {
  BadRequest: "bad_request",
  NotFound: "not_found",
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

/** Upload bounds: audio is transcribed, images reach vision models, and text is read inline. */
// 5 MB is the largest image every provider takes (Anthropic's limit).
export const UPLOAD_LIMITS = {
  imageBytes: 5 * 1024 * 1024,
  fileBytes: 2 * 1024 * 1024,
  audioBytes: 10 * 1024 * 1024,
} as const;

/** Maximum UTF-8 document snapshot rendered in the side panel. */
export const DOCUMENT_MAX_BYTES = 400_000;

/** How a contact relates to the owner: it shapes how the agent talks to them. */
export const PERSON_RELATIONS = [
  "partner",
  "family",
  "friend",
  "coworker",
  "client",
  "associate",
  "provider",
  "other",
] as const;

/** Names for a fresh super-agent, picked at random (and again from the setup's dice): a hint that the owner names it. */
export const AGENT_NAMES = [
  "Nova",
  "Milo",
  "Kira",
  "Lumo",
  "Iris",
  "Zeta",
  "Pipa",
  "Teo",
  "Luma",
  "Bruno",
  "Maya",
  "Coco",
] as const;

/** A name from AGENT_NAMES other than `current`, at random. */
export function randomAgentName(current?: string): string {
  const pool = AGENT_NAMES.filter((n) => n !== current);
  return pool[Math.floor(Math.random() * pool.length)] ?? AGENT_NAMES[0];
}

/** What a pairing QR carries: the core's addresses a device may reach, the one-time code and, maybe, the chat to open. */
export function pairingLink(p: { code: string; urls: readonly string[]; thread?: string }): string {
  const q = new URLSearchParams([["c", p.code], ...p.urls.map((u) => ["u", u] as [string, string])]);
  if (p.thread) q.set("t", p.thread);
  return `apx://pair?${q.toString()}`;
}
