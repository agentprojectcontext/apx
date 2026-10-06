#!/usr/bin/env node
import { getDefaultAutoSelectFamilyAttemptTimeout, setDefaultAutoSelectFamilyAttemptTimeout } from "node:net";
import { legacyHome, loadConfig } from "./config.ts";
import { moveLegacyHome } from "./home.ts";
import { createCore } from "./server.ts";
import { RESTART_CODE } from "./updates.ts";

// See HISTORY.md#connection-attempt-timeout.
setDefaultAutoSelectFamilyAttemptTimeout(Math.max(2000, getDefaultAutoSelectFamilyAttemptTimeout()));

const config = loadConfig();
if (moveLegacyHome({ home: config.home, legacy: legacyHome(), explicit: Boolean(process.env.APX_HOME) }) === "moved")
  console.warn(`APX moved its state from ${legacyHome()} to ${config.home}`);
const core = await createCore(config, {
  // After an update: close cleanly, then the supervisor starts the new code.
  restart: () => void core.close().finally(() => process.exit(RESTART_CODE)),
});

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.once(signal, async () => {
    await core.close();
    process.exit(0);
  });
}
