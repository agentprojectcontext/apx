import { ExtensionEventConfig, ExtensionEventInput } from "@apx/protocol";
import type { ApxClient } from "@apx/protocol/client";

const USAGE = `apx events get <extension>
apx events set <extension> enabled=true thread=home [quiet_start=1320 quiet_end=480 time_zone=UTC]
apx events emit <extension>/<event> <stable-id> '<JSON data>'`;

export async function events(client: ApxClient, [sub, id, ...args]: string[]) {
  if (!id) throw new Error(USAGE);
  if (sub === "get" && !args.length) {
    console.log(JSON.stringify(await client.call("extensions.events_get", { id }), null, 2));
    return;
  }
  if (sub === "set") {
    const previous = (await client.call("extensions.events_get", { id })).config;
    const values: Record<string, unknown> = { ...previous };
    for (const arg of args) {
      const at = arg.indexOf("=");
      if (at < 1) throw new Error(USAGE);
      const key = arg.slice(0, at);
      const raw = arg.slice(at + 1);
      values[key] =
        key === "enabled"
          ? raw === "true"
            ? true
            : raw === "false"
              ? false
              : raw
          : key === "quiet_start" || key === "quiet_end"
            ? Number(raw)
            : raw;
    }
    const config = ExtensionEventConfig.parse(values);
    console.log(JSON.stringify(await client.call("extensions.events_set", { id, config })));
    return;
  }
  if (sub === "emit" && args.length === 2) {
    const [extension, event, extra] = id.split("/");
    if (!extension || !event || extra) throw new Error(USAGE);
    const input = ExtensionEventInput.parse({ event, id: args[0], data: JSON.parse(args[1] ?? "") });
    console.log(JSON.stringify(await client.call("extensions.events_emit", { extension, input })));
    return;
  }
  throw new Error(USAGE);
}
