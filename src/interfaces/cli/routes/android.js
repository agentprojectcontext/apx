// apx android — argument routing.

import { cmdAndroidInstall, cmdAndroidStatus } from "../commands/android.js";

export default async function route(rest, { parseArgs, die }) {
  const sub = rest[0];
  const a = parseArgs(rest.slice(1));
  if (!sub || sub === "status") await cmdAndroidStatus(a);
  else if (sub === "install") await cmdAndroidInstall(a);
  else die(`unknown android subcommand: ${sub}\nUsage: apx android <install|status>`);
}
