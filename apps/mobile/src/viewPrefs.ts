// How the owner likes the lists on this phone, kept across launches. Secure storage is the one store the app has; a
// read that fails gives the default.
import * as SecureStore from "expo-secure-store";
import { useCallback, useEffect, useState } from "react";

const AGENTS = "apx.view.agents";
const PROJECTS = "apx.view.projects";
const HIDDEN_CHANNELS = "apx.view.hiddenChannels";
const BY_CHANNEL = "apx.view.byChannel";

/**
 * Whose chats Chats lists, as the panel's Inbox filter: only some agents' and some projects' ("default" for the Default
 * project), the channel accounts left out, and whether each account's chats go under one row (on unless turned off).
 */
export type ChatFilter = {
  agents: string[];
  projects: string[];
  hiddenChannels: string[];
  byChannel: boolean;
};
export const ALL_CHATS: ChatFilter = { agents: [], projects: [], hiddenChannels: [], byChannel: true };

/** Whether the filter hides anything, for the dot on its button; grouping hides nothing. */
export const filtering = (filter: ChatFilter): boolean =>
  filter.agents.length > 0 || filter.projects.length > 0 || filter.hiddenChannels.length > 0;

const ids = (value: string | null): string[] => (value ? value.split(",").filter(Boolean) : []);

export function useChatFilter(): [ChatFilter, (next: ChatFilter) => void] {
  const [filter, setFilter] = useState(ALL_CHATS);
  useEffect(() => {
    void Promise.all(
      [AGENTS, PROJECTS, HIDDEN_CHANNELS, BY_CHANNEL].map((key) => SecureStore.getItemAsync(key).catch(() => null)),
    ).then(([agents, projects, hidden, byChannel]) =>
      setFilter({
        agents: ids(agents ?? null),
        projects: ids(projects ?? null),
        hiddenChannels: ids(hidden ?? null),
        byChannel: byChannel !== "off",
      }),
    );
  }, []);
  const set = useCallback((next: ChatFilter) => {
    setFilter(next);
    SecureStore.setItemAsync(AGENTS, next.agents.join(",")).catch(() => {});
    SecureStore.setItemAsync(PROJECTS, next.projects.join(",")).catch(() => {});
    SecureStore.setItemAsync(HIDDEN_CHANNELS, next.hiddenChannels.join(",")).catch(() => {});
    SecureStore.setItemAsync(BY_CHANNEL, next.byChannel ? "on" : "off").catch(() => {});
  }, []);
  return [filter, set];
}
