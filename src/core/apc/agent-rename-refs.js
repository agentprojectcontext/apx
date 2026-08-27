// Repointing every LIVE reference to an agent's slug, in one place.
//
// The slug is the agent's physical key: it names the definition file and the
// runtime dir (agent-write.js moves those), but it is ALSO written into stores
// that live nowhere near the agent — a group roster, a Telegram route, a task's
// assignee, a delivery waiting to be crossed off. Moving the files and stopping
// there is what made a rename look successful and quietly break half the
// install: the agent kept its chats and lost its rooms, its telegram channel,
// its queue and its open tasks.
//
// The line this module draws: a POINTER is repointed, a RECORD is not.
//   pointer — something that has to resolve to a live agent for the system to
//             work (roster, route, assignee, queue key, RAG scope). Repointed.
//   record  — something that says what happened at a moment (`agent_slug` on a
//             ledger row, the attribution on a past turn, a2a thread keys).
//             Left alone: rewriting it would falsify history, and nothing
//             resolves it to act.
//
// Everything here is best-effort per store: a project with no routines, no
// queue or no telegram config is the normal case, and one unreadable store must
// never abort a rename that already moved files.
import fs from "node:fs";
import path from "node:path";

import { renameRoutineAgent } from "#core/stores/routines.js";
import { renameGroupParticipant } from "#core/stores/messages.js";
import { listTasks, patchTask } from "#core/stores/tasks.js";
import { renameDeliveryAgent } from "#core/stores/deliveries.js";
import { listCodeSessions, updateCodeSession } from "#core/stores/code-sessions.js";
import { readConfig, writeConfig } from "#core/config/index.js";
import { readJson, writeJson } from "#core/util/json-file.js";
import { apcProjectConfigFile } from "./paths.js";

/** Registry entries reach us either as daemon entries (`storagePath`) or as the
 *  `projects.list()` shape (`storage_path`). Accept both, drop the useless. */
function normalizeProjects(list) {
  return (Array.isArray(list) ? list : [])
    .map((e) => ({
      id: e?.id,
      path: e?.path || null,
      storagePath: e?.storagePath || e?.storage_path || null,
    }))
    .filter((e) => e.storagePath || e.path);
}

const samePath = (a, b) => {
  if (!a || !b) return false;
  try { return path.resolve(a) === path.resolve(b); } catch { return false; }
};

/**
 * Repoint every live pointer that names `oldSlug` in this project.
 *
 * @param {{id?:any, path:string, storagePath?:string, apxId?:string}} project
 * @param {string} oldSlug
 * @param {string} newSlug
 * @param {{projects?:object[]}} [opts]  the daemon's registry, when the caller
 *   has one. It buys two things nothing else can: rooms hosted by ANOTHER
 *   project that include this agent, and knowing which project a Telegram
 *   channel without an explicit `project` would fall back to.
 * @returns {Promise<Record<string, number>>} what moved, per store — the route
 *   logs it and the tests assert on it.
 */
export async function repointAgentReferences(project, oldSlug, newSlug, { projects = null } = {}) {
  const storage = project?.storagePath || project?.path;
  const registry = normalizeProjects(projects);
  const moved = {
    routines: 0, groups: 0, tasks: 0, deliveries: 0,
    code_sessions: 0, telegram: 0, project_config: 0, memory_index: 0,
  };
  if (!storage || !oldSlug || !newSlug || oldSlug === newSlug) return moved;

  // 1) Routines — `spec.agent` is what the scheduler executes.
  try { moved.routines = renameRoutineAgent(storage, oldSlug, newSlug); } catch { /* no store */ }

  // 2) Group rooms. The roster is the latest control row; here, plus any room
  //    hosted by another project whose `homes` map says this agent lives here.
  try {
    moved.groups += renameGroupParticipant(storage, oldSlug, newSlug, {
      homeId: project?.id ?? null, hostId: project?.id ?? null,
    });
  } catch { /* no ledger */ }
  for (const entry of registry) {
    if (project?.id == null || String(entry.id) === String(project.id)) continue;
    const otherStore = entry.storagePath || entry.path;
    if (!otherStore || samePath(otherStore, storage)) continue;
    try {
      moved.groups += renameGroupParticipant(otherStore, oldSlug, newSlug, {
        homeId: project.id, hostId: entry.id,
      });
    } catch { /* skip a project we cannot read */ }
  }

  // 3) Tasks — the assignee, in every state. A done task assigned to this agent
  //    is still assigned to this agent; only its slug changed.
  try {
    for (const t of listTasks(storage, { state: "all", agent: oldSlug })) {
      patchTask(storage, t.id, { agent: newSlug });
      moved.tasks += 1;
    }
  } catch { /* no task log */ }

  // 4) The delivery queue.
  try { moved.deliveries = renameDeliveryAgent(storage, oldSlug, newSlug); } catch { /* no queue */ }

  // 5) Code sessions owned by this agent.
  try {
    for (const s of listCodeSessions(storage)) {
      if (s.agentSlug !== oldSlug) continue;
      updateCodeSession(storage, s.id, { agentSlug: newSlug });
      moved.code_sessions += 1;
    }
  } catch { /* no code sessions */ }

  // 6) Telegram routing in the global config. A channel names its project by
  //    path, so only a channel pointing HERE is repointed — two projects may
  //    each own an agent with this slug. The bare `telegram.route_to_agent` is
  //    only live in env-only mode (resolveChannels falls back to it when no
  //    channels are configured), and it targets the first registered project.
  try {
    const cfg = readConfig();
    const tg = cfg.telegram || {};
    let touched = 0;
    const channels = Array.isArray(tg.channels) ? tg.channels : [];
    for (const c of channels) {
      if (c?.route_to_agent === oldSlug && samePath(c.project, project?.path)) {
        c.route_to_agent = newSlug;
        touched += 1;
      }
    }
    if (
      !channels.length && tg.route_to_agent === oldSlug &&
      registry.length && samePath(registry[0].path, project?.path)
    ) {
      tg.route_to_agent = newSlug;
      touched += 1;
    }
    if (touched) {
      cfg.telegram = tg;
      writeConfig(cfg);
      moved.telegram = touched;
    }
  } catch { /* config unreadable — leave it alone */ }

  // 7) The project's own `.apc/config.json`: its telegram override and any
  //    declarative routine. Project-scoped by definition, so no path matching.
  try {
    const file = apcProjectConfigFile(project.path);
    if (fs.existsSync(file)) {
      const cfg = readJson(file, null);
      let touched = 0;
      if (cfg && typeof cfg === "object") {
        if (cfg.telegram?.route_to_agent === oldSlug) {
          cfg.telegram.route_to_agent = newSlug;
          touched += 1;
        }
        for (const r of Array.isArray(cfg.routines) ? cfg.routines : []) {
          if (r?.agent === oldSlug) {
            r.agent = newSlug;
            touched += 1;
          }
        }
        if (touched) {
          writeJson(file, cfg);
          moved.project_config = touched;
        }
      }
    }
  } catch { /* not a valid project config */ }

  // 8) The RAG index. Agent memory is indexed under `agent:<projdir>:<slug>`;
  //    the next pass re-indexes memory.md under the new key on its own, so what
  //    is left to do is DROP the old rows — otherwise they linger unreachable
  //    and, worse, get inherited by whoever takes that slug next.
  //    Imported lazily: agent-write is on the CLI's load path and the memory
  //    subsystem (sqlite, embedders) has no business being pulled in with it.
  const apxId = project?.apxId || project?.apx_id || null;
  if (apxId) {
    try {
      const { getMemoryStore } = await import("#core/memory/index.js");
      const store = await getMemoryStore();
      moved.memory_index = store?.dropChannel?.(`agent:${apxId}:${oldSlug}`) || 0;
    } catch { /* memory disabled or unavailable */ }
  }

  return moved;
}
