import { createStore, useSlice } from "../data/createStore.ts";

/**
 * Whether a room's or group's card (who answers, when it speaks there, its rules) sits beside its chat. Like a contact's
 * card it stays as the owner left it from one room to the next; until then it is open on wide screens.
 */
const store = createStore<{ shown: boolean | undefined }>({ shown: undefined });
const wide = () => window.innerWidth >= 1280;
export const useRoomCard = () => useSlice(store, (s) => s.shown ?? wide());
export const toggleRoomCard = () => store.set((s) => ({ shown: !(s.shown ?? wide()) }));
export const closeRoomCard = () => store.set({ shown: false });
/** A group chat's card opens only when the owner asks for it: the chat is what they came for. */
export const useGroupCard = () => useSlice(store, (s) => s.shown === true);
export const toggleGroupCard = () => store.set((s) => ({ shown: s.shown !== true }));
