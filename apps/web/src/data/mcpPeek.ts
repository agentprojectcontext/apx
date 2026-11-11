import { createStore } from "./createStore.ts";

export type McpPeekTarget = { name: string; source?: string | undefined };
export const mcpPeek = createStore<{ target: McpPeekTarget | undefined }>({ target: undefined });
export const openMcp = (name: string, source?: string) => mcpPeek.set({ target: { name, source } });
export const closeMcp = () => mcpPeek.set({ target: undefined });
