import { useEffect, useState } from "react";
import {
  channelEnabledIn,
  channelPrefs,
  setChannelEnabled,
  onChannelPrefsChange,
  type ChannelAxis,
} from "../lib/channels";

/**
 * React binding for this device's per-channel choices (lib/channels.ts).
 *
 * The stored map holds only EXPLICIT choices, so `enabled()` falls through to
 * the surface default for anything untouched — which is what lets the phone
 * start with Telegram off without writing that opinion into storage as if the
 * owner had chosen it.
 *
 * Kept in state rather than read from localStorage per render so a change in
 * this tab (the chips) and one in another tab (the settings dialog) both
 * repaint, and so React has something to re-render on.
 */
export function useChannelPrefs(axis: ChannelAxis) {
  const [prefs, setPrefs] = useState<Record<string, boolean>>(() => channelPrefs(axis));

  useEffect(() => onChannelPrefsChange(() => setPrefs(channelPrefs(axis))), [axis]);

  const enabled = (channel: string | null | undefined): boolean =>
    channelEnabledIn(prefs, axis, channel);

  return {
    /** The stored map itself, so a caller can memoise against it. */
    prefs,
    enabled,
    set: (channel: string, on: boolean) => setChannelEnabled(axis, channel, on),
    toggle: (channel: string) => setChannelEnabled(axis, channel, !enabled(channel)),
  };
}
