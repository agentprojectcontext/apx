// The contract every channel (Telegram, WhatsApp, Discord, Slack…) implements. An adapter only translates: platform
// messages in, presentations out. Who someone is, what they may do and where a reply goes are decided by the manager
// and the core.
//
// A new channel, beyond receive/send, covers what its platform offers (each is optional; the app hides what is not):
// - delivery ticks: return the platform's id from `send`, and call `io.receipt` when it reaches their device or is
//   read (WhatsApp does; the Telegram Bot API tells neither, so its messages stop at "sent");
// - reactions in: call `io.reaction` when someone puts or takes off an emoji on a message (it never wakes the agent);
// - reactions out: set `caps.reactions` and `react`, so a closing "ok"/"gracias" can get an emoji (channel setting
//   `closers`); set `Inbound.ref` when the id to react to is not `external_id`;
// - presence (online / last seen) and avatars, where the platform shares them.
import type { ChannelInfo } from "@apx/protocol";
import type { Inbound, InboundAction, InboundReaction, Presentation } from "../domain/channels.ts";

export type InboundFile = NonNullable<Inbound["files"]>[number];

export type ChannelConfig = Omit<ChannelInfo, "token_set" | "token_hint" | "status" | "error" | "account">;

export type AdapterCaps = {
  /** Shows "typing…" while the agent works. */
  typing: boolean;
  /** Inline buttons (approve / deny, options). */
  buttons: boolean;
  /** Puts an emoji on a message (`react`). */
  reactions?: boolean;
  /** The emoji the platform is known to take as a reaction; `react` falls back to the closest when one is refused. */
  reactionSet?: readonly string[];
  /**
   * The channel is the owner's own account (WhatsApp on their own phone): a stranger never gets a pairing code from
   * it; their request is only listed for the owner to approve.
   */
  ownAccount?: boolean;
  /** Sends a sticker file as a sticker (an `OutFile` of kind "sticker"). */
  stickers?: boolean;
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
  /** Someone put an emoji on a message (by the platform's id), or took theirs off (`emoji` empty). */
  reaction?(r: InboundReaction): void;
  /** A message we sent (by the platform's id) reached their device, or was seen. */
  receipt?(externalId: string, state: "delivered" | "read"): void;
  /**
   * A group the bot is in, seen in an update, for a platform that cannot list them (Telegram); `left` when it was
   * removed from it. Offered in the rooms picker.
   */
  room?(r: { id: string; name: string; left?: boolean }): void;
  /** Connected as this account; `owner` is the owner's own address on it (a linked device is the owner). */
  identified?(who: { account: string; owner?: string }): void;
  /**
   * This channel's public address for its platform's webhooks (`<base>/hooks/<channel id>`), when the owner turned
   * one on (Settings › Channels › Public address); none otherwise. It can change while the channel runs (ngrok).
   */
  hookUrl?(): string | undefined;
  signal: AbortSignal;
};

/**
 * A request a platform sent to this channel's public address: `path` is what follows `/hooks/<channel id>` ("" or
 * "/…"), `headers` are lowercased, `body` is the bytes as they came (a signature is checked over them).
 */
export type HookRequest = { method: string; path: string; headers: Record<string, string>; body: Buffer };
export type HookResponse = {
  status: number;
  body?: string | Record<string, unknown>;
  headers?: Record<string, string>;
};

export interface ChannelAdapter {
  readonly caps: AdapterCaps;
  /**
   * Starts receiving; resolves with the account it runs as (a bot's @name) once connected, or `waiting` when linking or
   * connecting goes on in the background (a QR to scan, a socket's handshake) and `io.status` says when it runs.
   */
  start(io: AdapterIO): Promise<{ account?: string; waiting?: boolean }>;
  stop(): Promise<void>;
  /** The channel is removed: drop its persisted state, even if start was never called. */
  forget?(): Promise<void>;
  /**
   * A platform that delivers to a webhook (Teams, LINE): the request it sent to this channel's public address. The
   * adapter checks the platform's signature itself and refuses (401) what it cannot verify; nothing else guards it.
   */
  webhook?(req: HookRequest): Promise<HookResponse>;
  /** Text, then `files` (the presentation's media, already read). */
  send(conversation: string, p: Presentation, files?: OutFile[]): Promise<{ external_id?: string }>;
  typing?(conversation: string): Promise<void>;
  /** Puts the agent's emoji on a message (`ref`: the platform's id of it); "" takes it off. */
  react?(conversation: string, ref: string, emoji: string): Promise<void>;
  /** Replaces the buttons under a message APX sent (`ref`: the platform's id of it); none takes them off. */
  setButtons?(conversation: string, ref: string, buttons: Presentation["buttons"]): Promise<void>;
  /** Takes a message APX sent out of the chat; fails when the platform no longer allows it. */
  remove?(conversation: string, ref: string): Promise<void>;
  /** The profile picture someone shows on the platform (none when hidden or not set). */
  avatar?(externalId: string): Promise<{ mime: string; data: Buffer } | undefined>;
  /**
   * Who of these is online, as far as the platform told (those who hide it never show). Asking starts listening for
   * them, so the first answer may be empty.
   */
  presence?(externalIds: string[]): Record<string, Presence>;
  /**
   * The rooms of the servers the bot is in (to pick from instead of typing ids), and whether it may write in each. A
   * platform without it offers the groups it reported through `io.room`.
   */
  rooms?(): Promise<ServerRoom[]>;
  /**
   * Asks the platform to send these messages again, for files that never arrived (WhatsApp: the owner's phone resends
   * each by its id); resolves with what came. An id missing from `found` got no answer.
   */
  recover?(conversation: string, messages: Array<{ id: string; fromMe: boolean }>): Promise<Recovered>;
}

/** Each message that came again: its file, or why it has none. */
export type Recovered = {
  found: Array<{ id: string; file?: InboundFile | undefined; failure?: string | undefined }>;
};

export type ServerRoom = { id: string; name: string; server: string; writable: boolean };

export type Presence = { online: boolean; last_seen?: string };

/**
 * A media file to send: an image goes as a photo, OGG audio as a voice note, other audio as an audio file, a sticker as
 * a sticker where the channel has them (`caps.stickers`).
 */
export type OutFile = {
  kind: "image" | "audio" | "file" | "sticker";
  mime: string;
  data: Buffer;
  name?: string | undefined;
};

/** The name a file goes out with: its own, else one made from its kind and type ("image.png"). */
export function fileName(f: OutFile): string {
  if (f.name) return f.name;
  const ext =
    f.kind === "image" || f.kind === "sticker"
      ? f.mime === "application/x-tgsticker"
        ? "tgs"
        : (f.mime.split("/")[1] ?? "png")
      : f.mime === "audio/ogg"
        ? "ogg"
        : f.kind === "audio"
          ? "mp3"
          : "bin";
  return `${f.kind}.${ext}`;
}

export type AdapterFactory = (config: ChannelConfig, token: string | undefined) => ChannelAdapter;
