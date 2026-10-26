import type { Task, Thread } from "@apx/protocol";
import { t } from "../i18n/index.ts";
import { client } from "./client.ts";
import { notify } from "./notices.ts";
import { updateThread } from "./threadAdmin.ts";

/** Only this task's own chats, not consults or unrelated chats of its assignee. */
export function taskChatIds(task: Task, sessions: Thread[]): string[] {
  return [
    ...new Set([
      task.thread_id,
      ...sessions
        .filter((s) => s.task_id === task.id && s.project_id === task.project_id && s.kind !== "home")
        .map((s) => s.id),
    ]),
  ];
}

/** Archive is an arrangement of chats, not a task outcome or an instruction to resume work. */
export async function archiveTaskChats(id: string, archived: boolean): Promise<boolean> {
  try {
    const { task, sessions } = await client.call("tasks.get", { task: id });
    for (const thread of taskChatIds(task, sessions)) {
      if (!(await updateThread(thread, { archived }))) return false;
    }
    return true;
  } catch (e) {
    notify(t("error.updateChat", { error: e instanceof Error ? e.message : String(e) }));
    return false;
  }
}
