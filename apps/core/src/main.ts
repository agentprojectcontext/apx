#!/usr/bin/env node
import { getDefaultAutoSelectFamilyAttemptTimeout, setDefaultAutoSelectFamilyAttemptTimeout } from "node:net";
import { exitWhenClosed } from "@apx/protocol/exit";
import { legacyHome, loadConfig } from "./config.ts";
import { acquireDaemonLock } from "./daemon-lock.ts";
import { moveLegacyHome } from "./home.ts";
import { createCore } from "./server.ts";
import { restartAfterClose } from "./updates.ts";

// See HISTORY.md#connection-attempt-timeout.
setDefaultAutoSelectFamilyAttemptTimeout(Math.max(2000, getDefaultAutoSelectFamilyAttemptTimeout()));

const config = loadConfig();
const startupLock = acquireDaemonLock(`${config.home}.startup`);
const lock = (() => {
  try {
    if (
      moveLegacyHome({ home: config.home, legacy: legacyHome(), explicit: Boolean(process.env.APX_HOME) }) === "moved"
    )
      console.warn(`APX moved its state from ${legacyHome()} to ${config.home}`);
    return acquireDaemonLock(config.home);
  } finally {
    startupLock.release();
  }
})();
process.once("exit", () => lock.release());
const core = await createCore(config, {
  // After an update: close, then the supervisor starts the new code.
  restart: () =>
    void restartAfterClose(
      () => core.close(),
      (code) => exitWhenClosed(code),
    ),
});

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.once(signal, async () => {
    await core.close();
    exitWhenClosed(0);
  });
}
