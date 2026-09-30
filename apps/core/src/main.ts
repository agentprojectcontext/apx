#!/usr/bin/env node
import { loadConfig } from "./config.ts";
import { createCore } from "./server.ts";

const core = await createCore(loadConfig());

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.once(signal, async () => {
    await core.close();
    process.exit(0);
  });
}
