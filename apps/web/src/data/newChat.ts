// A chat the owner opened but has not written in yet. It lives only here, under an id of its own, and the core makes
// it with its first message: opening "New chat" and leaving leaves nothing behind.
import type { ModelChoice, Thread } from "@apx/protocol";
import { useMemo } from "react";
import { useT } from "../i18n/index.ts";
import { createStore, useSlice } from "./createStore.ts";
import { useData } from "./state.ts";

/** Who the new chat is with, where, and whether it is a code session (an outside engine's, when `engine`). */
export type NewChat = { agent: string; project?: string; code?: boolean; engine?: string };

const PREFIX = "new:";

/** The same agent, project and kind give the same id, so a new chat opened again finds its draft. */
export function newChatId(c: NewChat): string {
  const q = new URLSearchParams({ agent: c.agent });
  if (c.project) q.set("project", c.project);
  if (c.engine) q.set("engine", c.engine);
  else if (c.code) q.set("code", "1");
  return `${PREFIX}${q}`;
}

export const isNewChat = (id: string | undefined): id is string => Boolean(id?.startsWith(PREFIX));

export function parseNewChat(id: string | undefined): NewChat | undefined {
  if (!isNewChat(id)) return undefined;
  const q = new URLSearchParams(id.slice(PREFIX.length));
  const agent = q.get("agent");
  if (!agent) return undefined;
  const project = q.get("project") ?? undefined;
  const engine = q.get("engine") ?? undefined;
  return { agent, ...(project ? { project } : {}), ...(engine ? { engine } : q.get("code") ? { code: true } : {}) };
}

/** The model picked in a new chat's composer, given to the chat when it is made. */
const choices = createStore<Record<string, ModelChoice | undefined>>({});

export function chooseNewChatModel(id: string, choice: ModelChoice | null): void {
  choices.set({ [id]: choice ?? undefined });
}

/** The model picked for a new chat, forgotten as the chat is made. */
export function takeNewChatModel(id: string): ModelChoice | undefined {
  const choice = choices.get()[id];
  choices.set({ [id]: undefined });
  return choice;
}

/** A new chat as a thread the chat screen can show; undefined for any other id or when its agent is gone. */
export function useNewChat(id: string | undefined): Thread | undefined {
  const t = useT();
  const spec = useMemo(() => parseNewChat(id), [id]);
  const known = useData((s) => (spec ? spec.agent in s.agents : false));
  const choice = useSlice(choices, (s) => (id ? s[id] : undefined));
  return useMemo(() => {
    if (!spec || !id || !known) return undefined;
    const now = new Date().toISOString();
    return {
      id,
      kind: spec.code || spec.engine ? "code" : "loose",
      title: t("chat.new"),
      agent_ids: [spec.agent],
      ...(spec.project ? { project_id: spec.project } : {}),
      ...(spec.engine ? { engine: spec.engine } : {}),
      ...(choice ? { model_choice: choice } : {}),
      state: "idle",
      preview: "",
      unread: 0,
      created_at: now,
      updated_at: now,
    };
  }, [id, spec, known, choice, t]);
}
