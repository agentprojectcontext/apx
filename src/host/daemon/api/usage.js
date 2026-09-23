// The spend breaker, from outside (core/agent/spend-breaker.js).
//
//   GET  /usage/breaker          — limits, calls by unwatched work in the last hour, the pause if any
//   POST /usage/breaker/resume   — lift the pause now
//
// The breaker lives in the daemon's memory — it is about the last hour — so
// these are the only way to see or lift it. The usage LOG (~/.apx/usage) is
// read straight off disk by `apx usage` and needs no route.
import { readConfig } from "#core/config/index.js";
import { resumeSpend, spendState } from "#core/agent/spend-breaker.js";

export function register(api) {
  api.get("/usage/breaker", (_req, res) => {
    res.json(spendState({ config: readConfig() }));
  });

  api.post("/usage/breaker/resume", (_req, res) => {
    const was = resumeSpend();
    res.json({ resumed: Boolean(was), was: was || null, state: spendState({ config: readConfig() }) });
  });
}
