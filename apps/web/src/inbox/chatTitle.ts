import type { Thread } from "@apx/protocol";
import { dayLabel } from "../common/format.ts";
import type { T } from "../i18n/index.ts";

/**
 * A chat's name on screen: a call is named by when it began ("Call · Today · 14:18"), never by its stored title. In a
 * list row the time is already beside it, so a call is only "Call" there.
 */
export function chatTitle(thread: Pick<Thread, "kind" | "title" | "created_at">, t: T, row = false): string {
  if (thread.kind !== "call") return thread.title;
  return row ? t("call.name") : t("call.titled", { when: dayLabel(thread.created_at) });
}
