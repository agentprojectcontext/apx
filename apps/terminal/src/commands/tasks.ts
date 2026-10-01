// apx2 tasks: the office board from the terminal.
import type { ApxClient } from "@apx/protocol/client";

const USAGE = `apx2 tasks [--project p]                 Open tasks by column
apx2 tasks add <title…> [--project p] [--agent a] [--person name --owed me|them] [--due 2026-10-05]
apx2 tasks commitments                    What you owe and what you are owed
apx2 tasks move <id> <column>
apx2 tasks done|drop|reopen <id>
apx2 tasks say <id> <text…>               Comment; @agent asks that agent there`;

export async function tasks(
  client: ApxClient,
  [sub, id, ...rest]: string[],
  opts: {
    project?: string | undefined;
    agent?: string | undefined;
    person?: string | undefined;
    owed?: string | undefined;
    due?: string | undefined;
  },
): Promise<void> {
  if (sub === "add") {
    const title = [id, ...rest].filter(Boolean).join(" ");
    if (!title) throw new Error(USAGE);
    const t = await client.call("tasks.create", {
      title,
      ...(opts.project ? { project: opts.project } : {}),
      ...(opts.agent ? { assignee: opts.agent } : {}),
      ...(opts.person ? { person: opts.person, owed_by: opts.owed === "them" ? "person" : "owner" } : {}),
      ...(opts.due ? { due_at: opts.due } : {}),
    });
    console.log(`${t.id}  ${t.status}${t.due_at ? `  due ${new Date(t.due_at).toLocaleString()}` : ""}`);
    return;
  }
  if (sub === "commitments") {
    const { tasks: list } = await client.call("tasks.list", { commitments: true });
    for (const [label, owed] of [
      ["You owe", "owner"],
      ["Owed to you", "person"],
    ] as const) {
      const rows = list.filter((t) => t.owed_by === owed);
      if (!rows.length) continue;
      console.log(`\n${label}`);
      for (const t of rows)
        console.log(
          `  ${t.id}  ${t.title}  · ${t.person_name}${t.due_at ? `  · due ${new Date(t.due_at).toLocaleString()}` : ""}`,
        );
    }
    if (!list.length) console.log("(no open commitments)");
    return;
  }
  if (sub === "move" && id && rest[0]) {
    await client.call("tasks.update", { task: id, status: rest[0] });
    return;
  }
  if ((sub === "done" || sub === "drop" || sub === "reopen") && id) {
    await client.call("tasks.close", {
      task: id,
      state: sub === "done" ? "done" : sub === "drop" ? "dropped" : "open",
    });
    return;
  }
  if (sub === "say" && id && rest.length) {
    const r = await client.call("tasks.comment", { task: id, text: rest.join(" ") });
    console.log(r.runs.length ? `${r.runs.length} agent(s) will answer in the task` : "commented");
    return;
  }
  if (sub) throw new Error(USAGE);
  const { tasks: list, columns } = await client.call("tasks.list", opts.project ? { project: opts.project } : {});
  for (const c of columns) {
    const cards = list.filter((t) => t.status === c.id);
    if (!cards.length) continue;
    console.log(`\n${c.label}`);
    for (const t of cards)
      console.log(
        `  ${t.id}  ${t.title}${t.assignee ? `  · ${t.assignee}` : ""}${t.awaits_owner ? "  · waiting for you" : ""}`,
      );
  }
  if (!list.length) console.log(`(no open tasks)\n\n${USAGE}`);
}
