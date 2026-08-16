// apx desktop — argument routing.
//
// Extracted from the 457-line dispatch() switch in cli/index.js. Each command
// owns its own routing and imports only the command functions it calls, so the
// CLI no longer loads all 38 command modules to run one of them.

import { cmdDesktopInstall, cmdDesktopRestart, cmdDesktopStart, cmdDesktopStatus, cmdDesktopStop, cmdDesktopUninstall } from "../commands/desktop.js";

export default async function route(rest, { parseArgs, die }) {
  const [sub, ...oRest] = rest;
  const oArgs = parseArgs(oRest);
  if (!sub || sub === "start")  { await cmdDesktopStart(oArgs); return; }
  if (sub === "stop")           { await cmdDesktopStop(oArgs);  return; }
  if (sub === "restart")        { await cmdDesktopRestart(oArgs); return; }
  if (sub === "status")         { await cmdDesktopStatus(oArgs);return; }
  if (sub === "install")        { await cmdDesktopInstall(oArgs);  return; }
  if (sub === "uninstall")      { await cmdDesktopUninstall(oArgs);return; }
  die(`unknown desktop sub-command: ${sub}\nUsage: apx desktop <start|stop|restart|status|install|uninstall>`);
  return;
}
