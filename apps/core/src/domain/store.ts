// The store: one repository per aggregate over the same SQLite file. Every write that changes what a client
// shows emits one event on the bus.
import type { Bus } from "../bus.ts";
import type { Db } from "../db/db.ts";
import { agentsRepo } from "./agents.ts";
import { approvalsRepo } from "./approvals.ts";
import { auxCallsRepo } from "./aux-calls.ts";
import { channelsRepo } from "./channels.ts";
import { clientsRepo } from "./clients.ts";
import { devicesRepo } from "./devices.ts";
import { extensionsRepo } from "./extensions.ts";
import { inputsRepo } from "./inputs.ts";
import { jobsRepo } from "./jobs.ts";
import { mediaRepo } from "./media.ts";
import { memoriesRepo } from "./memories.ts";
import { memorySourcesRepo } from "./memory-sources.ts";
import { memoryWorkRepo } from "./memory-work.ts";
import { modelLogRepo } from "./model-log.ts";
import { notificationsRepo } from "./notifications.ts";
import { nudgesRepo } from "./nudges.ts";
import { personsRepo } from "./persons.ts";
import { projectsRepo } from "./projects.ts";
import { routinesRepo } from "./routines.ts";
import { runsRepo } from "./runs.ts";
import { harnessSessionsRepo, idempotencyRepo, settingsRepo } from "./settings.ts";
import { sql } from "./sql.ts";
import { stickersRepo } from "./stickers.ts";
import { suggestionsRepo } from "./suggestions.ts";
import { surfacesRepo } from "./surfaces.ts";
import { tasksRepo } from "./tasks.ts";
import { messagesRepo, threadsRepo } from "./threads.ts";

export function createStore(db: Db, bus: Bus) {
  const q = sql(db);
  const approvals = approvalsRepo(q);
  // Agents and projects change in bursts (a project's reindex writes each agent): one event per burst.
  let teamPending = false;
  const teamChanged = () => {
    if (teamPending) return;
    teamPending = true;
    queueMicrotask(() => {
      teamPending = false;
      bus.emit({ type: "team.updated" });
    });
  };
  return {
    tx: q.tx,
    projects: projectsRepo(q, teamChanged),
    agents: agentsRepo(q, teamChanged),
    threads: threadsRepo(q, bus, approvals.endSession),
    messages: messagesRepo(q, bus),
    modelLog: modelLogRepo(q),
    memorySources: memorySourcesRepo(q),
    runs: runsRepo(q, bus),
    auxCalls: auxCallsRepo(q),
    inputs: inputsRepo(q),
    approvals,
    jobs: jobsRepo(q, bus),
    memories: memoriesRepo(q),
    memoryWork: memoryWorkRepo(q),
    media: mediaRepo(q),
    persons: personsRepo(q),
    suggestions: suggestionsRepo(q),
    channels: channelsRepo(q),
    stickers: stickersRepo(q),
    surfaces: surfacesRepo(q, bus),
    tasks: tasksRepo(q, bus),
    routines: routinesRepo(q),
    notifications: notificationsRepo(q, bus),
    extensions: extensionsRepo(q),
    clients: clientsRepo(q),
    devices: devicesRepo(q),
    nudges: nudgesRepo(q),
    settings: settingsRepo(q),
    harnessSessions: harnessSessionsRepo(q),
    idempotency: idempotencyRepo(q),
  };
}

export type Store = ReturnType<typeof createStore>;
export type { AgentRecord } from "./agents.ts";
