import type { Result } from "@apx/protocol";
import { client } from "./client.ts";

/** A task's history, chats, consults, subtasks and usage, loaded with its panel. */
export type TaskDetail = Omit<Result<"tasks.get">, "task" | "comments" | "comments_truncated">;

export async function taskDetail(task: string): Promise<TaskDetail> {
  try {
    const {
      task: _t,
      comments: _comments,
      comments_truncated: _truncated,
      ...detail
    } = await client.call("tasks.get", { task });
    return {
      ...detail,
      attachments: detail.attachments ?? [],
      consults: detail.consults ?? [],
      subtasks: detail.subtasks ?? [],
      usage: detail.usage ?? [],
    };
  } catch {
    return { events: [], sessions: [], consults: [], subtasks: [], usage: [], attachments: [] };
  }
}
