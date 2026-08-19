// apx panel — argument routing.
//
// Extracted from the 457-line dispatch() switch in cli/index.js. Each command
// owns its own routing and imports only the command functions it calls, so the
// CLI no longer loads all 38 command modules to run one of them.

import {
  cmdPanelShare,
  cmdPanelStatus,
  cmdPanelTailscaleOff,
  cmdPanelTailscaleOn,
  cmdPanelTailscaleStatus,
  cmdPanelUnshare,
} from "../commands/panel.js";

export default async function route(rest, { parseArgs, die }) {
  const sub = rest[0];
  const a = parseArgs(rest.slice(1));
  if (!sub || sub === "status") await cmdPanelStatus(a);
  else if (sub === "share") await cmdPanelShare(a);
  else if (sub === "unshare") await cmdPanelUnshare(a);
  else if (sub === "tailscale") {
    const how = rest[1];
    if (!how || how === "status") await cmdPanelTailscaleStatus();
    else if (how === "on") await cmdPanelTailscaleOn();
    else if (how === "off") await cmdPanelTailscaleOff();
    else die(`unknown panel tailscale subcommand: ${how}\nUsage: apx panel tailscale <status|on|off>`);
  } else die(`unknown panel subcommand: ${sub}\nUsage: apx panel <status|share|unshare|tailscale>`);
}
