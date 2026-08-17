// apx artifact — argument routing.
//
// Extracted from the 457-line dispatch() switch in cli/index.js. Each command
// owns its own routing and imports only the command functions it calls, so the
// CLI no longer loads all 38 command modules to run one of them.

import { cmdArtifactCreate, cmdArtifactList, cmdArtifactPreview, cmdArtifactPreviews, cmdArtifactRemove, cmdArtifactRun, cmdArtifactShare, cmdArtifactShow, cmdArtifactStop } from "../commands/artifact.js";

// Aliases accepted for this command. Declared here, next to the command
// itself — a global alias table would be wrong, since the same word means
// different things under different commands ("rm" is remove under `agent`,
// unset under `project config`, revoke under `pair`).
export const aliases = ["artifacts"];

export default async function route(rest, { parseArgs, die }) {
  const sub = rest[0];
  const a = parseArgs(rest.slice(1));
  if (!sub || sub === "list" || sub === "ls") await cmdArtifactList(a);
  else if (sub === "create" || sub === "new") await cmdArtifactCreate(a);
  else if (sub === "show" || sub === "get") await cmdArtifactShow(a);
  else if (sub === "remove" || sub === "rm") await cmdArtifactRemove(a);
  else if (sub === "run") await cmdArtifactRun(a);
  else if (sub === "preview" || sub === "serve") await cmdArtifactPreview(a);
  else if (sub === "share") await cmdArtifactShare(a);
  else if (sub === "previews") await cmdArtifactPreviews(a);
  else if (sub === "stop") await cmdArtifactStop(a);
  else die(`unknown artifact subcommand: ${sub}`);
}
