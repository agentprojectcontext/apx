import type { ChannelInfo } from "@apx/protocol";
import type { ChannelDraft, NewAccount } from "../../data/channels.ts";

/** What each part of an account's settings gets: the account, its settings with unsaved edits, and how to edit them. */
export type PaneProps = {
  channel: ChannelInfo;
  draft: ChannelDraft;
  set(patch: Partial<ChannelDraft>): void;
  /** Saves the settings now, with a new secret (a token, a password) when given: the account starts again. */
  saveNow(secret?: string): Promise<boolean>;
};

/** A new account not made yet: connecting makes it, with these settings and its secret (who answers: the super-agent). */
export type Create = (account: NewAccount, secret?: string) => Promise<boolean>;
