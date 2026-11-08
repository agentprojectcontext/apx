import type { ChannelDraft } from "../../data/channels.ts";

/** The edits still unsaved once `sent` is saved: those changed after it went out. */
export function keptAfter(now: Partial<ChannelDraft>, sent: Partial<ChannelDraft>): Partial<ChannelDraft> {
  return Object.fromEntries(
    Object.entries(now).filter(([k, v]) => v !== sent[k as keyof ChannelDraft]),
  ) as Partial<ChannelDraft>;
}
