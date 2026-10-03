// The contract every channel (Telegram, later WhatsApp…) implements. An adapter only translates: platform messages in,
// presentations out. Who someone is, what they may do and where a reply goes are decided by the manager and the core.
import type { ChannelInfo } from "@apx/protocol";
import type { Inbound, InboundAction, Presentation } from "../domain/channels.ts";

export type ChannelConfig = Omit<ChannelInfo, "token_set" | "token_hint" | "status" | "error" | "account">;

export type AdapterCaps = {
  /** Shows "typing…" while the agent works. */
  typing: boolean;
  /** Inline buttons (approve / deny, options). */
  buttons: boolean;
  /**
   * The channel is the owner's own account (WhatsApp): a stranger never gets an answer, not even a pairing code; their
   * request is only listed for the owner to approve.
   */
  ownAccount?: boolean;
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

/** The platform refused the channel (a bad token): starting again will not help until the owner changes it. */
export class ChannelRefused extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ChannelRefused";
  }
}

export type AdapterIO = {
  /** Stores the message; returns once it is safe to tell the platform it arrived. */
  receive(m: Inbound): void;
  /** A button press. */
  action(a: InboundAction): void;
  /** Running, or failing (bad token, network): shown in the app. */
  status(s: "running" | "error", error?: string): void;
  /** A QR to link the account (none once linked or expired), shown to the owner in the app. */
  qr?(code: string | undefined): void;
  /** Connected as this account; `owner` is the owner's own address on it (a linked device is the owner). */
  identified?(who: { account: string; owner?: string }): void;
  signal: AbortSignal;
};

export interface ChannelAdapter {
  readonly caps: AdapterCaps;
  /**
   * Starts receiving; resolves with the account it runs as (a bot's @name) once connected, or `waiting` when linking
   * goes on in the background (a QR to scan) and its state comes through `io`.
   */
  start(io: AdapterIO): Promise<{ account?: string; waiting?: boolean }>;
  stop(): Promise<void>;
  /** The channel is removed: drop what it keeps (a linked device's credentials). */
  forget?(): Promise<void>;
  /** Text, then `files` (the presentation's media, already read). */
  send(conversation: string, p: Presentation, files?: OutFile[]): Promise<{ external_id?: string }>;
  typing?(conversation: string): Promise<void>;
}

/** A media file to send: an image goes as a photo, OGG audio as a voice note, other audio as an audio file. */
export type OutFile = { kind: "image" | "audio"; mime: string; data: Buffer };

export type AdapterFactory = (config: ChannelConfig, token: string | undefined) => ChannelAdapter;
