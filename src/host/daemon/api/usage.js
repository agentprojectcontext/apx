// The spend breaker, from outside (core/agent/spend-breaker.js).
//
//   GET  /usage/breaker          — limits, calls by unwatched work in the last hour, the pause if any
//   POST /usage/breaker/resume   — lift the pause now
//
// The breaker lives in the daemon's memory — it is about the last hour — so
// these are the only way to see or lift it. The usage LOG (~/.apx/usage) is
// read straight off disk by `apx usage` and needs no route.
import fs from "node:fs/promises";
import { CONFIG_PATH } from "#core/config/index.js";
import { resumeSpend, spendState } from "#core/agent/spend-breaker.js";
import { asyncRoute } from "./shared.js";

// The limits are the only thing read from config, and a missing or broken file
// just means the defaults (rule 15: no sync I/O on a request path).
async function limitsConfig() {
  try {
    return JSON.parse(await fs.readFile(CONFIG_PATH, "utf8"));
  } catch {
    return {};
  }
}

export function register(api) {
  api.get("/usage/breaker", asyncRoute(async (_req, res) => {
    res.json(spendState({ config: await limitsConfig() }));
  }));

  api.post("/usage/breaker/resume", asyncRoute(async (_req, res) => {
    const was = resumeSpend();
    res.json({ resumed: Boolean(was), was: was || null, state: spendState({ config: await limitsConfig() }) });
  }));
}
