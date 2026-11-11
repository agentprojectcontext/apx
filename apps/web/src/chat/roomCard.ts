import { createStore, useSlice } from "../data/createStore.ts";

/** The room or group chat whose card (when the agent speaks there, its rules) is open over the chat. */
const store = createStore<{ open: string | undefined }>({ open: undefined });
export const useRoomCard = (thread: string) => useSlice(store, (s) => s.open === thread);
export const toggleRoomCard = (thread: string) => store.set((s) => ({ open: s.open === thread ? undefined : thread }));
export const closeRoomCard = () => store.set({ open: undefined });
