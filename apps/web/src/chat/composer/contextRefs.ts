// What the owner adds to a message as context from the composer's + menu: a project, a chat, a task or a file. Kept per
// chat like its draft, shown as chips, and told to the agent with the message.
import { useSyncExternalStore } from "react";

export type ContextRef = { kind: "project" | "chat" | "task" | "file"; id: string; label: string };

const refs = new Map<string, readonly ContextRef[]>();
const listeners = new Set<() => void>();
const NONE: readonly ContextRef[] = [];

const changed = () => {
  for (const l of listeners) l();
};
const subscribe = (fn: () => void) => {
  listeners.add(fn);
  return () => listeners.delete(fn);
};

export const refsOf = (chat: string): readonly ContextRef[] => refs.get(chat) ?? NONE;

export function addRef(chat: string, ref: ContextRef): void {
  const now = refsOf(chat);
  if (now.some((r) => r.kind === ref.kind && r.id === ref.id)) return;
  refs.set(chat, [...now, ref]);
  changed();
}

export function removeRef(chat: string, ref: ContextRef): void {
  refs.set(
    chat,
    refsOf(chat).filter((r) => !(r.kind === ref.kind && r.id === ref.id)),
  );
  changed();
}

/** Takes them for a message being sent; `restore` gives them back when it could not go. */
export function takeRefs(chat: string): readonly ContextRef[] {
  const now = refsOf(chat);
  if (now.length) {
    refs.delete(chat);
    changed();
  }
  return now;
}

export function restoreRefs(chat: string, back: readonly ContextRef[]): void {
  for (const r of back) addRef(chat, r);
}

export function useContextRefs(chat: string): readonly ContextRef[] {
  return useSyncExternalStore(subscribe, () => refsOf(chat));
}

/**
 * The message with what was added to it, as a block after the owner's words the agent reads: each by its kind, its
 * name and its id (or a file's path), so the agent can open it with its tools.
 */
export function withRefs(words: string, added: readonly ContextRef[]): string {
  if (!added.length) return words;
  const lines = added.map((r) => (r.kind === "file" ? `- file: ${r.id}` : `- ${r.kind} ${r.id}: ${r.label}`));
  return `${words}\n\n[context the owner added]\n${lines.join("\n")}`;
}
