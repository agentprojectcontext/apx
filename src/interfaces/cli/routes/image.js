// apx image — argument routing.
//
// One positional (the prompt) or a reserved subcommand (providers /
// capabilities), plus flags. The command function does the disambiguation, so
// this hands straight off.

import { cmdImage } from "../commands/image.js";

export default async function route(rest, { parseArgs }) {
  await cmdImage(parseArgs(rest));
}
