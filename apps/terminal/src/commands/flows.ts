import type { Params, Result } from "@apx/protocol";
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
    case "events": {
      if (!args[0]) throw new Error(`usage: apx flows ${sub} <flow> [cursor]`);
      const cursor: unknown = args[1] ? JSON.parse(args[1]) : undefined;
      result =
        sub === "rows"
          ? await client.call("flows.rows", {
              flow: args[0],
              ...(cursor === undefined ? {} : { cursor: cursor as Params<"flows.rows">["cursor"] }),
            })
          : await client.call("flows.events", {
              flow: args[0],
              ...(cursor === undefined ? {} : { cursor: cursor as Params<"flows.events">["cursor"] }),
            });
      break;
    }
    case "export": {
      if (!args[0] || !project)
        throw new Error(
          "usage: apx flows export <flow> --project <id> (disable the Flow and finish/cancel active runs first)",
        );
      const flow = args[0];
      const definition = (await client.call("flows.list", { project })).flows.find((f) => f.id === flow);
      if (!definition || definition.enabled) throw new Error("Export requires a disabled Flow in the selected project");
      const rows: Result<"flows.rows">["rows"] = [];
      const events: Result<"flows.events">["events"] = [];
      let rowCursor: string | undefined;
      do {
        const page = await client.call("flows.rows", { flow, limit: 100, ...(rowCursor ? { cursor: rowCursor } : {}) });
        rows.push(...page.rows);
        rowCursor = page.nextCursor ?? undefined;
      } while (rowCursor);
      let eventCursor: Params<"flows.events">["cursor"];
      do {
        const page = await client.call("flows.events", {
          flow,
          limit: 100,
          ...(eventCursor ? { cursor: eventCursor } : {}),
        });
        events.push(...page.events);
        eventCursor = page.nextCursor ?? undefined;
      } while (eventCursor);
      // A published drawing and its runs step by step (values over 4,000 characters are cut, marked `truncated`).
      const graph = await client.call("flows.graph_get", { flow });
      const runs: Result<"flows.run_get">[] = [];
      for (const e of events)
        if (e.executor === "graph") runs.push(await client.call("flows.run_get", { flow, event: e.event_id }));
      result = { definition, rows, events, graph, runs };
      break;
    }
    case "write":
      if (!args[0] || !args[1] || args[2] === undefined)
        throw new Error("usage: apx flows write <flow> <key> '<value JSON>'");
      result = await client.call("flows.write", { flow: args[0], key: args[1], value: JSON.parse(args[2]) });
      break;
    case "retire":
      if (!args[0] || args[1] !== "confirm-exported")
        throw new Error(
          "usage: apx flows retire <flow> confirm-exported (verify your export first; permanently removes Flow data; identifier cannot be reused)",
        );
      result = await client.call("flows.retire", { flow: args[0], confirm: true, exported: true });
      break;
    case "retry":
      if (!args[0] || !args[1]) throw new Error("usage: apx flows retry <flow> <event>");
      result = await client.call("flows.retry", { flow: args[0], event: args[1] });
      break;
    case "run":
    case "stop": {
      // A run may send messages as the owner and call other services: it is the owner's own, not an agent's.
      if (process.env.APX_AGENT !== undefined)
        throw new Error(`apx flows ${sub} acts as the owner, so it does not run inside an agent's command.`);
      if (sub === "run") {
        if (!args[0]) throw new Error("usage: apx flows run <flow> ['<sample body JSON>']");
        result = await client.call("flows.run_now", {
          flow: args[0],
          ...(args[1] === undefined ? {} : { data: JSON.parse(args[1]) as unknown }),
        });
      } else {
        if (!args[0] || !args[1]) throw new Error("usage: apx flows stop <flow> <event>");
        result = await client.call("flows.cancel_run", { flow: args[0], event: args[1] });
      }
      break;
    }
    default:
      console.log(
        "apx flows list --project <id> | set '<definition JSON>' | rows <flow> [cursor JSON] | events <flow> [cursor JSON] | export <flow> --project <id> | write <flow> <key> '<JSON>' | retry <flow> <event> | run <flow> ['<JSON>'] | stop <flow> <event> | retire <flow> confirm-exported",
      );
      return;
  }
  console.log(JSON.stringify(result, null, 2));
}
