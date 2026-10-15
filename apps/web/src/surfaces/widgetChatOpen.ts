import { createStore } from "../data/createStore.ts";

/** The widget whose chat is open over the page, and the chat. Apart from the host so the shell can wait to load it. */
export const widgetChatOpen = createStore<{ surfaceId?: string; threadId?: string }>({});
