import { go } from "../shell/nav.ts";
import type { ChannelKind } from "./kinds.ts";

/** A kind's settings: of its first account when one is connected, else the setup of a new one. */
export function openChannelKind(kind: ChannelKind, accounts: readonly { id: string; type: string }[]): void {
  const first = accounts.find((c) => c.type === kind);
  if (first) go.channelSettings(kind, first.id);
  else go.newChannel(kind);
}
