// The store: one repository per aggregate over the same SQLite file. Every write that changes what a client
// shows emits one event on the bus.
import type { Bus } from "../bus.ts";
import type { Db } from "../db/db.ts";
import { agentsRepo } from "./agents.ts";
import { inputsRepo } from "./inputs.ts";
import { projectsRepo } from "./projects.ts";
import { runsRepo } from "./runs.ts";
import { harnessSessionsRepo, idempotencyRepo, settingsRepo } from "./settings.ts";
import { sql } from "./sql.ts";
import { surfacesRepo } from "./surfaces.ts";
import { messagesRepo, modelLogRepo, threadsRepo } from "./threads.ts";

export function createStore(db: Db, bus: Bus) {
  const q = sql(db);
  return {
    tx: q.tx,
    projects: projectsRepo(q),
    agents: agentsRepo(q),
    threads: threadsRepo(q, bus),
    messages: messagesRepo(q, bus),
    modelLog: modelLogRepo(q),
    runs: runsRepo(q, bus),
    inputs: inputsRepo(q),
    surfaces: surfacesRepo(q, bus),
    settings: settingsRepo(q),
    harnessSessions: harnessSessionsRepo(q),
    idempotency: idempotencyRepo(q),
  };
}

export type Store = ReturnType<typeof createStore>;
export type { AgentRecord } from "./agents.ts";
