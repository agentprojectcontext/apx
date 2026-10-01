// The contract every channel (Telegram, later WhatsApp…) implements. An adapter only translates: platform messages in,
// presentations out. Who someone is, what they may do and where a reply goes are decided by the manager and the core.
import type { ChannelInfo } from "@apx/protocol";
import type { Inbound, InboundAction, Presentation } from "../domain/channels.ts";

export type ChannelConfig = Omit<ChannelInfo, "token_set" | "status" | "error" | "account">;

export type AdapterCaps = {
  /** Shows "typing…" while the agent works. */
  typing: boolean;
  /** Inline buttons (approve / deny, options). */
  buttons: boolean;
};

/** Why a send failed: worth trying again (nothing went out), maybe delivered (never resend blindly), or final. */
export class SendError extends Error {
  readonly kind: "retry" | "uncertain" | "fatal";
  readonly retryAfterMs: number | undefined;
  /** Parts of a long message already delivered before this failure (a retry continues after them). */
  readonly sentParts: number;
  constructor(kind: "retry" | "uncertain" | "fatal", message: string, retryAfterMs?: number, sentParts = 0) {
    super(message);
    this.name = "SendError";
    this.kind = kind;
    this.retryAfterMs = retryAfterMs;
    this.sentParts = sentParts;
  }
}

export type AdapterIO = {
  /** Stores the message; returns once it is safe to tell the platform it arrived. */
  receive(m: Inbound): void;
  /** A button press. */
  action(a: InboundAction): void;
  /** Running, or failing (bad token, network): shown in the app. */
  status(s: "running" | "error", error?: string): void;
  signal: AbortSignal;
};

export interface ChannelAdapter {
  readonly caps: AdapterCaps;
  /** Starts receiving; resolves with the account it runs as (a bot's @name) once connected. */
  start(io: AdapterIO): Promise<{ account?: string }>;
  stop(): Promise<void>;
  /** Text, then `files` (the presentation's media, already read). */
  send(conversation: string, p: Presentation, files?: OutFile[]): Promise<{ external_id?: string }>;
  typing?(conversation: string): Promise<void>;
}

/** A media file to send: an image goes as a photo, OGG audio as a voice note, other audio as an audio file. */
export type OutFile = { kind: "image" | "audio"; mime: string; data: Buffer };

export type AdapterFactory = (config: ChannelConfig, token: string | undefined) => ChannelAdapter;
