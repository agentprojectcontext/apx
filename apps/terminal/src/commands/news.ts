// apx news: the release news APX carries, and telling them now (to see how the super-agent words them).
import type { ApxClient } from "@apx/protocol/client";

export async function news(
  client: ApxClient,
  [sub, ...ids]: string[],
  o: { json?: boolean | undefined },
): Promise<void> {
  if (sub === "tell") {
    const r = await client.call("system.news_tell", ids.length ? { ids } : {});
    if (o.json) console.log(JSON.stringify(r, null, 2));
    else if (!r.told.length) console.log("Nothing to tell: every entry that applies was already told");
    else
      console.log(
        `Told ${r.told.join(", ")} ${r.voiced ? "in the super-agent's words" : "as plain text (no API model)"}, ${r.sent ? "on your channel and in Home" : "in Home only (no channel took it)"}`,
      );
    return;
  }
  if (sub) throw new Error("usage: apx news [tell [<id>…]] [--json]");
  const { entries } = await client.call("system.news", {});
  if (o.json) {
    console.log(JSON.stringify(entries, null, 2));
    return;
  }
  for (const e of entries)
    console.log(
      `${e.seen ? " " : "•"} ${e.id} (${e.since}) · ${e.title}${e.applies ? "" : " · does not apply"}${e.actions.length ? `\n    ${e.actions.join(" · ")}` : ""}`,
    );
  console.log(entries.length ? "\n• not told yet" : "(no news)");
}
