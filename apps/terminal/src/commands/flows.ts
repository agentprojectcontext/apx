import type { Params } from "@apx/protocol";
import type { ApxClient } from "@apx/protocol/client";

export async function flows(client: ApxClient, [sub = "help", ...args]: string[], project?: string): Promise<void> {
  let result: unknown;
  switch (sub) {
    case "list":
      if (!project) throw new Error("usage: apx flows list --project <id>");
      result = await client.call("flows.list", { project });
      break;
    case "set":
      if (!args[0]) throw new Error("usage: apx flows set '<definition JSON>'");
      result = await client.call("flows.set", JSON.parse(args[0]) as Params<"flows.set">);
      break;
    case "rows":
    case "events":
      if (!args[0]) throw new Error(`usage: apx flows ${sub} <flow>`);
      result =
        sub === "rows"
          ? await client.call("flows.rows", { flow: args[0] })
          : await client.call("flows.events", { flow: args[0] });
      break;
    case "write":
      if (!args[0] || !args[1] || args[2] === undefined)
        throw new Error("usage: apx flows write <flow> <key> '<value JSON>'");
      result = await client.call("flows.write", { flow: args[0], key: args[1], value: JSON.parse(args[2]) });
      break;
    case "retry":
      if (!args[0] || !args[1]) throw new Error("usage: apx flows retry <flow> <event>");
      result = await client.call("flows.retry", { flow: args[0], event: args[1] });
      break;
    default:
      console.log(
        "apx flows list --project <id> | set '<definition JSON>' | rows <flow> | events <flow> | write <flow> <key> '<JSON>' | retry <flow> <event>",
      );
      return;
  }
  console.log(JSON.stringify(result, null, 2));
}
