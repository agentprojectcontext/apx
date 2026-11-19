import { methods } from "@apx/protocol";
import type { ApxClient } from "@apx/protocol/client";

type Options = { apply?: boolean; id?: string; revision?: string };
const usage =
  "usage: apx agents move <agent> <destination> [relative-path…] [--apply --id <preview-id> --revision <revision>] | apx agents move recover <id>";

/** Preview is the default; applying sends exactly the selection and revision the owner reviewed. */
export async function agentMove(client: ApxClient, args: string[], options: Options = {}) {
  if (args[0] === "recover") {
    if (args.length !== 2 || options.apply || options.id || options.revision) throw new Error(usage);
    const params = methods["agents.migration_recover"].params.parse({ id: args[1] });
    console.log(JSON.stringify(await client.call("agents.migration_recover", params), null, 2));
    return;
  }
  const [agent, destination, ...paths] = args;
  if (!agent || !destination) throw new Error(usage);
  if (!options.apply && (options.id || options.revision)) throw new Error(usage);
  if (options.apply) {
    if (!options.id || !options.revision) throw new Error(usage);
    const params = methods["agents.migrate"].params.parse({
      agent,
      destination,
      paths,
      id: options.id,
      revision: options.revision,
    });
    console.log(JSON.stringify(await client.call("agents.migrate", params), null, 2));
  } else {
    const params = methods["agents.migration_preview"].params.parse({ agent, destination, paths });
    console.log(JSON.stringify(await client.call("agents.migration_preview", params), null, 2));
  }
}
