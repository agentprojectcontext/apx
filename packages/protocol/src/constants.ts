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

/** What can be attached: images the model can look at, and text it can read (PDFs and others are only listed). */
// 5 MB is the largest image every provider takes (Anthropic's limit).
export const UPLOAD_LIMITS = { imageBytes: 5 * 1024 * 1024, fileBytes: 2 * 1024 * 1024 } as const;

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
