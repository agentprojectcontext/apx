// Public entry point for routines. Re-exports the CRUD helpers from
// core/stores/routines.js plus the runner — so callers (CLI, HTTP, scheduler,
// MCP server) import everything from one place.
export {
  listRoutines,
  getRoutine,
  upsertRoutine,
  deleteRoutine,
  setEnabled,
  updateRunState,
  getDueRoutines,
  parseSchedule,
  computeNextRun,
} from "#core/stores/routines.js";

export { runRoutineNow } from "./runner.js";

// Runtime state of a run (in flight) and its history (already made). Both are
// "what happened to this routine", asked from every surface, so they belong in
// the same entry point as the CRUD and the runner.
export {
  startRoutineRun,
  getRoutineRun,
  listRoutineRuns,
  RUN_PHASES,
} from "./active-runs.js";

export {
  listRoutineRunLog,
  isRoutineRunRow,
  runRowStatus,
  RUN_STATUS,
} from "./run-log.js";

export {
  deliveryChannelIds,
  normalizeDeliverTo,
  resolveDeliveryChannels,
  PROFILE_DELIVERY,
  NO_DELIVERY,
} from "./delivery.js";

