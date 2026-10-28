// How the owner likes the lists on this phone, kept across launches. Secure storage is the one store the app has; a
// read that fails gives the default.
import * as SecureStore from "expo-secure-store";
import { useCallback, useEffect, useState } from "react";

const ROUTINES = "apx.view.routines";
const TASKS = "apx.view.tasks";
const AGENTS = "apx.view.agents";

/** What Chats lists: routine runs and task chats (both on unless turned off), and only some agents' chats. */
export type ChatFilter = { routines: boolean; tasks: boolean; agents: string[] };
export const ALL_CHATS: ChatFilter = { routines: true, tasks: true, agents: [] };

/** Whether the filter hides anything, for the dot on its button. */
export const filtering = (filter: ChatFilter): boolean => !filter.routines || !filter.tasks || filter.agents.length > 0;

export function useChatFilter(): [ChatFilter, (next: ChatFilter) => void] {
  const [filter, setFilter] = useState(ALL_CHATS);
  useEffect(() => {
    void Promise.all([ROUTINES, TASKS, AGENTS].map((key) => SecureStore.getItemAsync(key).catch(() => null))).then(
      ([routines, tasks, agents]) =>
        setFilter({
          routines: routines !== "off",
          tasks: tasks !== "off",
          agents: agents ? agents.split(",").filter(Boolean) : [],
        }),
    );
  }, []);
  const set = useCallback((next: ChatFilter) => {
    setFilter(next);
    SecureStore.setItemAsync(ROUTINES, next.routines ? "on" : "off").catch(() => {});
    SecureStore.setItemAsync(TASKS, next.tasks ? "on" : "off").catch(() => {});
    SecureStore.setItemAsync(AGENTS, next.agents.join(",")).catch(() => {});
  }, []);
  return [filter, set];
}
