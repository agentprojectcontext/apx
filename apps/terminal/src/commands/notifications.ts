// apx2 notifications: the attention tray from the terminal.
import type { ApxClient } from "@apx/protocol/client";

const KIND: Record<string, string> = {
  input: "needs your OK",
  task: "task waiting",
  routine: "routine",
  channel: "channel",
};

export async function notifications(client: ApxClient, [sub]: string[]): Promise<void> {
  if (sub === "read") {
    const r = await client.call("notifications.read", {});
    console.log(`${r.unread} unread`);
    return;
  }
  if (sub) throw new Error("usage: apx2 notifications [read]");
  const { notifications: list, unread } = await client.call("notifications.list", {});
  for (const n of list)
    console.log(
      `${n.read_at ? " " : "•"} ${new Date(n.created_at).toLocaleString()}  ${KIND[n.kind] ?? n.kind} · ${n.title}${n.body ? ` — ${n.body.replaceAll("\n", " ").slice(0, 100)}` : ""}${n.thread_id ? `  [${n.thread_id}]` : ""}`,
    );
  console.log(list.length ? `\n${unread} unread` : "(nothing for you)");
}
