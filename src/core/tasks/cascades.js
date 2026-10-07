// Which task threads have an agent turn running right now.
//
// A leaf module on purpose: comment-turn.js owns the cascade and imports the
// whole turn engine, while the task detail (API, get_task) only needs to ask
// "is somebody working this thread at this moment" — importing comment-turn for
// that would pull the tool registry into its own handlers.
//
// A count, not a set: an owner's cascade and an agent's can overlap on one
// task, and the first to finish must not clear the guard for the other. In
// memory, so it says nothing across a restart — which is the honest answer.
const active = new Map();

export const cascadeKey = (storagePath, taskId) => `${storagePath}|${taskId}`;

export function enterCascade(key) {
  active.set(key, (active.get(key) || 0) + 1);
}

export function leaveCascade(key) {
  const n = (active.get(key) || 0) - 1;
  if (n > 0) active.set(key, n);
  else active.delete(key);
}

export function cascadeActive(key) {
  return active.has(key);
}

/** Is an agent turn running on this task right now? */
export function isTaskCascadeRunning(storagePath, taskId) {
  return active.has(cascadeKey(storagePath, taskId));
}

/** Test seam. */
export function _resetCascades() {
  active.clear();
}
