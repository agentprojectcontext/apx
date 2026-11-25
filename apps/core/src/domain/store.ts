// The store: one repository per aggregate over the same SQLite file. Every write that changes what a client
// shows emits one event on the bus.
import type { Bus } from "../bus.ts";
import type { Db } from "../db/db.ts";
import { agentMigrationReceipt, commitAgentMigration } from "./agent-migration-data.ts";
import { agentMigrationInventory } from "./agent-migration-inventory.ts";
import { pendingMigrationsRepo } from "./agent-migration-pending.ts";
import { checkedMigrationRecovery, restoreAgentMigration } from "./agent-migration-restore.ts";
import { sealAgentMigration } from "./agent-migration-seal.ts";
import { agentsRepo } from "./agents.ts";
import { approvalsRepo } from "./approvals.ts";
import { auxCallsRepo } from "./aux-calls.ts";
import { channelsRepo } from "./channels.ts";
import { clientsRepo } from "./clients.ts";
import { devicesRepo } from "./devices.ts";
import { extensionCatalogsRepo } from "./extension-catalogs.ts";
import { extensionEventsRepo } from "./extension-events.ts";
import { extensionsRepo } from "./extensions.ts";
import { flowGraphRunsRepo } from "./flow-graph-runs.ts";
import { flowGraphsRepo } from "./flow-graphs.ts";
import { flowSchedulesRepo } from "./flow-schedules.ts";
import { flowSendsRepo } from "./flow-sends.ts";
import { flowTablesRepo } from "./flow-tables.ts";
import { flowsRepo } from "./flows.ts";
import { inputsRepo } from "./inputs.ts";
import { jobsRepo } from "./jobs.ts";
import { mediaRepo } from "./media.ts";
import { memoriesRepo } from "./memories.ts";
import { memorySourcesRepo } from "./memory-sources.ts";
import { memoryWorkRepo } from "./memory-work.ts";
import { messagesRepo } from "./messages.ts";
import { modelLogRepo } from "./model-log.ts";
import { notificationsRepo } from "./notifications.ts";
import { nudgesRepo } from "./nudges.ts";
import { personsRepo } from "./persons.ts";
import { projectProtectionRepo } from "./project-protection.ts";
import { projectsRepo } from "./projects.ts";
import { retentionRepo } from "./retention.ts";
import { routinesRepo } from "./routines.ts";
import { runContextsRepo } from "./run-contexts.ts";
import { runsRepo } from "./runs.ts";
import { harnessSessionsRepo, idempotencyRepo, settingsRepo } from "./settings.ts";
import { sharedFilesRepo } from "./shared-files.ts";
import { sql } from "./sql.ts";
import { stickersRepo } from "./stickers.ts";
import { suggestionsRepo } from "./suggestions.ts";
import { surfacesRepo } from "./surfaces.ts";
import { taskAttachmentsRepo } from "./task-attachments.ts";
import { taskLanesRepo } from "./task-lanes.ts";
import { tasksRepo } from "./tasks.ts";
import { threadsRepo } from "./threads.ts";
import { workflowsRepo } from "./workflows.ts";

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
    agentMigrationPending: pendingMigrationsRepo(q),
    agentMigration: {
      inventory: (agent: string, destination: string) => agentMigrationInventory(q, agent, destination),
      commit: (inventory: Parameters<typeof commitAgentMigration>[1], id?: string) => {
        const receipt = commitAgentMigration(q, inventory, id);
        approvals.reloadSessions();
        for (const thread of inventory.threads) approvals.endSession(thread);
        teamChanged();
        return receipt;
      },
      restore: (id: string) => {
        const receipt = restoreAgentMigration(q, id);
        approvals.reloadSessions();
        teamChanged();
        return receipt;
      },
      seal: (id: string): void => sealAgentMigration(q, id),
      checkRestore: (id: string): void => {
        checkedMigrationRecovery(q, id);
      },
      receipt: (id: string) => agentMigrationReceipt(q, id),
    },
    flows: flowsRepo(db),
    flowGraphs: flowGraphsRepo(db),
    flowGraphRuns: flowGraphRunsRepo(db),
    flowSchedules: flowSchedulesRepo(db),
    flowTables: flowTablesRepo(db),
    flowSends: flowSendsRepo(db),
    projectProtection: projectProtectionRepo(q),
    projects: projectsRepo(q, teamChanged),
    agents: agentsRepo(q, teamChanged),
    threads: threadsRepo(q, bus, approvals.endSession),
    messages: messagesRepo(q, bus),
    modelLog: modelLogRepo(q),
    retention: retentionRepo(q),
    memorySources: memorySourcesRepo(q),
    runs: runsRepo(q, bus),
    runContexts: runContextsRepo(q),
    auxCalls: auxCallsRepo(q),
    inputs: inputsRepo(q),
    approvals,
    jobs: jobsRepo(q, bus),
    memories: memoriesRepo(q),
    memoryWork: memoryWorkRepo(q),
    media: mediaRepo(q),
    sharedFiles: sharedFilesRepo(q),
    taskAttachments: taskAttachmentsRepo(q),
    persons: personsRepo(q),
    suggestions: suggestionsRepo(q),
    channels: channelsRepo(q),
    stickers: stickersRepo(q),
    surfaces: surfacesRepo(q, bus),
    tasks: tasksRepo(q, bus),
    taskLanes: taskLanesRepo(q),
    routines: routinesRepo(q),
    notifications: notificationsRepo(q, bus),
    extensions: extensionsRepo(q),
    extensionEvents: extensionEventsRepo(q),
    extensionCatalogs: extensionCatalogsRepo(q),
    workflows: workflowsRepo(q),
    clients: clientsRepo(q),
    devices: devicesRepo(q),
    nudges: nudgesRepo(q),
    settings: settingsRepo(q),
    harnessSessions: harnessSessionsRepo(q),
    idempotency: idempotencyRepo(q),
  };
}

export type Store = ReturnType<typeof createStore>;
