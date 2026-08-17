// apx voice — argument routing.
//
// Extracted from the 457-line dispatch() switch in cli/index.js. Each command
// owns its own routing and imports only the command functions it calls, so the
// CLI no longer loads all 38 command modules to run one of them.

import { cmdVoiceListen, cmdVoiceProviders, cmdVoiceSay } from "../commands/voice.js";

export default async function route(rest, { parseArgs, die }) {
  const [sub, ...vRest] = rest;
  const vArgs = parseArgs(vRest);
  if (sub === "say")        { await cmdVoiceSay(vArgs); return; }
  if (sub === "listen")     { await cmdVoiceListen(vArgs); return; }
  if (sub === "providers" || sub === "list") { await cmdVoiceProviders(); return; }
  die(`unknown voice sub-command: ${sub || "(missing)"}\nUsage: apx voice <say|listen|providers>`);
  return;
}
