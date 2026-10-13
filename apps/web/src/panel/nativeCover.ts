import { createStore } from "../data/createStore.ts";

/** While a column edge is dragged the native page steps behind the panel: over it, the pointer never reaches us. */
export const nativeCover = createStore({ on: false });
export const coverNativeViews = (on: boolean) => nativeCover.set({ on });
