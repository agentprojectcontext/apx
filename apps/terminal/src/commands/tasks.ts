// apx tasks: the office board from the terminal.
import fs from "node:fs";
import type { ApxClient } from "@apx/protocol/client";
import { authorOf, messageText } from "./threads.ts";

const USAGE = `apx tasks [--project p]                 Open tasks by column
apx tasks add <title…> [--project p] [--agent a] [--person name --owed me|them] [--due 2026-10-05]
                         [--start 2026-10-05T09:00]   Its agent starts then, not at once
apx tasks show <id>                      Its fields, description and comments
apx tasks edit <id> [--title t] [--desc d | --desc-file f|-] [--agent a] [--due d] [--start d] [--tags a,b]
                    [--reviewer owner|<agent>]   Change only what is given; --agent "", --due "", --start "" clear them
apx tasks commitments                    What you owe and what you are owed
apx tasks settle <id> kept|missed|dropped [note…]
apx tasks settle <id> renegotiated --due <date> [note…]
                                         How a commitment went; renegotiated keeps it open with the new date
apx tasks move <id> <column>
apx tasks done|drop|reopen <id>
apx tasks say <id> <text…>               Comment; @agent asks that agent there`;

type Opts = {
  project?: string | undefined;
  agent?: string | undefined;
  person?: string | undefined;
  owed?: string | undefined;
  due?: string | undefined;
  start?: string | undefined;
  reviewer?: string | undefined;
  title?: string | undefined;
  desc?: string | undefined;
  descFile?: string | undefined;
  tags?: string | undefined;
};

const when = (iso: string) => new Date(iso).toLocaleString();

/** tasks.update params for `apx tasks edit`: only the fields given; "" clears the agent and the due date. */
export function taskEditOf(
  task: string,
  o: Opts,
  readFile = (f: string) => fs.readFileSync(f === "-" ? 0 : f, "utf8"),
) {
  if (o.desc !== undefined && o.descFile) throw new Error("give the description as --desc or --desc-file, not both");
  const description = o.descFile ? readFile(o.descFile) : o.desc;
  const patch = {
    ...(o.title !== undefined ? { title: o.title } : {}),
    ...(description !== undefined ? { description } : {}),
    ...(o.agent !== undefined ? { assignee: o.agent || null } : {}),
    ...(o.due !== undefined ? { due_at: o.due || null } : {}),
    ...(o.start !== undefined ? { start_at: o.start || null } : {}),
    ...(o.reviewer !== undefined ? { reviewer: o.reviewer || null } : {}),
    ...(o.tags !== undefined
      ? {
          tags: o.tags
            .split(",")
            .map((t) => t.trim())
            .filter(Boolean),
        }
      : {}),
  };
  if (!Object.keys(patch).length) throw new Error(`nothing to change\n\n${USAGE}`);
  return { task, ...patch };
}

export async function tasks(client: ApxClient, [sub, id, ...rest]: string[], opts: Opts): Promise<void> {
  if (sub === "help") {
    console.log(USAGE);
    return;
  }
  if (sub === "show" && id) {
    const { task: t, sessions } = await client.call("tasks.get", { task: id });
    console.log(`${t.id}  ${t.title}`);
    const fields: [string, string | undefined][] = [
      [
        "Status",
        `${t.status}${t.state === "open" ? "" : ` (${t.state})`}${t.awaits_owner ? " · waiting for you" : ""}`,
      ],
      ["Agent", t.assignee],
      ["Project", t.project_id],
      ["Due", t.due_at && when(t.due_at)],
      ["Starts", t.start_at && when(t.start_at)],
      ["Reviewer", t.status === "review" ? (t.reviewer ?? "you") : undefined],
      ["Tags", t.tags.join(", ") || undefined],
      ["Person", t.person_name && `${t.person_name} · ${t.owed_by === "person" ? "owed to you" : "you owe it"}`],
      ["Thread", t.thread_id],
      ["Worked in", sessions.map((x) => x.id).join(", ") || undefined],
    ];
    for (const [label, value] of fields) if (value) console.log(`${`${label}:`.padEnd(11)}${value}`);
    if (t.description.trim()) console.log(`\n${t.description.trim()}`);
    // Comments live in the task's own conversation.
    const { messages } = await client.call("threads.get", { thread: t.thread_id });
    const comments = messages.filter((m) => m.author.kind !== "system" && messageText(m).trim());
    console.log(comments.length ? "\nComments" : "\n(no comments)");
    for (const m of comments) console.log(`  ${when(m.created_at)}  ${authorOf(m.author)}\n    ${messageText(m)}`);
    return;
  }
  if (sub === "edit" && id) {
    const t = await client.call("tasks.update", taskEditOf(id, opts));
    console.log(
      `${t.id}  saved · ${t.title}${t.assignee ? `  · ${t.assignee}` : ""}${t.due_at ? `  · due ${when(t.due_at)}` : ""}`,
    );
    return;
  }
  if (sub === "add") {
    const title = [id, ...rest].filter(Boolean).join(" ");
    if (!title) throw new Error(USAGE);
    const t = await client.call("tasks.create", {
      title,
      ...(opts.project ? { project: opts.project } : {}),
      ...(opts.agent ? { assignee: opts.agent } : {}),
      ...(opts.person ? { person: opts.person, owed_by: opts.owed === "them" ? "person" : "owner" } : {}),
      ...(opts.due ? { due_at: opts.due } : {}),
      ...(opts.start ? { start_at: opts.start } : {}),
    });
    console.log(
      `${t.id}  ${t.status}${t.start_at ? `  starts ${when(t.start_at)}` : ""}${t.due_at ? `  due ${new Date(t.due_at).toLocaleString()}` : ""}`,
    );
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
  if (sub === "settle" && id && rest[0]) {
    const [outcome, ...note] = rest;
    if (outcome !== "kept" && outcome !== "missed" && outcome !== "dropped" && outcome !== "renegotiated")
      throw new Error(USAGE);
    const t = await client.call("tasks.settle", {
      task: id,
      outcome,
      ...(opts.due ? { due_at: opts.due } : {}),
      ...(note.length ? { note: note.join(" ") } : {}),
    });
    console.log(`${t.id}  ${outcome}${t.state === "open" && t.due_at ? `  · due ${when(t.due_at)}` : ""}`);
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
    // From an agent's command a comment would read as the owner's and reach the task's agent: agents use task_comment.
    if (process.env.APX_AGENT !== undefined)
      throw new Error(
        "apx tasks say speaks as the owner, so it does not run inside an agent's command: use task_comment.",
      );
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
