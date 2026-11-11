// How the owner likes the lists on this phone, kept across launches. Secure storage is the one store the app has; a
// read that fails gives the default.
import * as SecureStore from "expo-secure-store";
import { useCallback, useEffect, useState } from "react";

const ROUTINES = "apx.view.routines";
const TASKS = "apx.view.tasks";
const AGENTS = "apx.view.agents";
const HIDDEN_CHANNELS = "apx.view.hiddenChannels";
const BY_CHANNEL = "apx.view.byChannel";

/**
 * What Chats lists: routine runs and task chats (both on unless turned off), only some agents' chats, the channel
 * accounts left out, and whether each account's chats go under one row (on unless turned off).
 */
export type ChatFilter = {
  routines: boolean;
  tasks: boolean;
  agents: string[];
  hiddenChannels: string[];
  byChannel: boolean;
};
export const ALL_CHATS: ChatFilter = { routines: true, tasks: true, agents: [], hiddenChannels: [], byChannel: true };

/** Whether the filter hides anything, for the dot on its button; grouping hides nothing. */
export const filtering = (filter: ChatFilter): boolean =>
  !filter.routines || !filter.tasks || filter.agents.length > 0 || filter.hiddenChannels.length > 0;

const ids = (value: string | null): string[] => (value ? value.split(",").filter(Boolean) : []);

export function useChatFilter(): [ChatFilter, (next: ChatFilter) => void] {
  const [filter, setFilter] = useState(ALL_CHATS);
  useEffect(() => {
    void Promise.all(
      [ROUTINES, TASKS, AGENTS, HIDDEN_CHANNELS, BY_CHANNEL].map((key) =>
        SecureStore.getItemAsync(key).catch(() => null),
      ),
    ).then(([routines, tasks, agents, hidden, byChannel]) =>
      setFilter({
        routines: routines !== "off",
        tasks: tasks !== "off",
        agents: ids(agents ?? null),
        hiddenChannels: ids(hidden ?? null),
        byChannel: byChannel !== "off",
      }),
    );
  }, []);
  const set = useCallback((next: ChatFilter) => {
    setFilter(next);
    SecureStore.setItemAsync(ROUTINES, next.routines ? "on" : "off").catch(() => {});
    SecureStore.setItemAsync(TASKS, next.tasks ? "on" : "off").catch(() => {});
    SecureStore.setItemAsync(AGENTS, next.agents.join(",")).catch(() => {});
    SecureStore.setItemAsync(HIDDEN_CHANNELS, next.hiddenChannels.join(",")).catch(() => {});
    SecureStore.setItemAsync(BY_CHANNEL, next.byChannel ? "on" : "off").catch(() => {});
  }, []);
  return [filter, set];
}
