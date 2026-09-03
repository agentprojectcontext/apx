// Board columns: ONE catalog, shared by every project; each project picks which
// of them it shows.
//
// This settles a real tension in how one person uses one tool. Dev work wants
// pending → running → in review → blocked; a personal list wants pending and
// done and nothing else. "Every project the same" makes the second list carry
// four columns it never uses; "every project its own" means `qa` on one board
// is a different thing from `qa` on the next, and an agent told to "move it to
// QA" has to ask which QA. So: the VOCABULARY is global and editable, and the
// SUBSET is per project.
//
// A column is a task `status`. That is why this is cheap: nothing in the daemon
// branches on the value of `status` — it is a validation whitelist, a label, and
// something to group by. Making the whitelist configurable is the whole feature.
//
// `done` is never in the catalog. It is a task's `state`, not its status, and it
// is the one column every board ends with — dragging a card there closes the
// task, dragging it out reopens it. Making it configurable would let someone
// build a board with no way to finish anything.
import { TASK_STATUSES, DEFAULT_TASK_STATUS } from "#core/stores/tasks.js";

/** The terminal column every board gets, appended after the configured ones. */
export const DONE_COLUMN = "done";

/** Shipped catalog — exactly the statuses that existed before this was configurable. */
export const DEFAULT_TASK_COLUMNS = Object.freeze(
  TASK_STATUSES.map((id) => Object.freeze({ id, label: null })),
);

const ID_RE = /^[a-z0-9][a-z0-9_-]{0,31}$/;

/**
 * The on-enter automation, or nothing. An `agent` is required — an instruction
 * with nobody to carry it out is not a half-configured hook, it is no hook.
 */
function normalizeHook(value) {
  const agent = String(value?.agent || "").trim().toLowerCase();
  if (!agent || !ID_RE.test(agent)) return {};
  const instruction = typeof value?.instruction === "string" ? value.instruction.trim() : "";
  return { on_enter: { agent, instruction: instruction || null } };
}

/** A usable column id: slug-shaped, and never the reserved terminal one. */
export function isColumnId(value) {
  const id = String(value || "").trim().toLowerCase();
  return ID_RE.test(id) && id !== DONE_COLUMN;
}

/**
 * Clean a catalog coming from config or from an HTTP body. Anything unusable is
 * dropped rather than rejected: this reads stored data, and one bad row must not
 * blank out a board.
 *
 * `label: null` means "use the built-in translation for this id" — that is how
 * the four shipped columns stay bilingual while a custom one keeps the exact
 * words its author typed.
 *
 * `on_enter` is the automation: `{ agent, instruction }` means "when a task
 * lands in this column, hand it to that agent". The slug is resolved against
 * the TASK'S OWN project, which is what lets one global "QA" column put each
 * project's own qa agent to work. A project without that agent simply does
 * nothing — a card that silently summoned a stranger would be worse.
 */
export function normalizeColumns(value) {
  if (!Array.isArray(value)) return [...DEFAULT_TASK_COLUMNS];
  const seen = new Set();
  const out = [];
  for (const raw of value) {
    const id = String((typeof raw === "string" ? raw : raw?.id) || "").trim().toLowerCase();
    if (!isColumnId(id) || seen.has(id)) continue;
    seen.add(id);
    const label = typeof raw?.label === "string" && raw.label.trim() ? raw.label.trim() : null;
    out.push({ id, label, ...normalizeHook(raw?.on_enter) });
  }
  // A board with no columns is not a board. Falling back beats showing nothing.
  return out.length ? out : [...DEFAULT_TASK_COLUMNS];
}

/** The automation configured on a column, or null. */
export function columnHook(columns, id) {
  return columns.find((c) => c.id === id)?.on_enter || null;
}

/** The global catalog: every column name that exists anywhere. */
export function readColumnCatalog(globalConfig) {
  return normalizeColumns(globalConfig?.tasks?.columns);
}

/**
 * The columns ONE project shows, in order, with `done` appended.
 *
 * A project that has chosen nothing shows the whole catalog — that is the old
 * behaviour, and a board that starts empty would look broken.
 *
 * @param {object} globalConfig
 * @param {object} projectConfig  the project's own `.apc/config.json`
 * @returns {{id: string, label: string|null}[]}
 */
export function projectColumns(globalConfig, projectConfig) {
  const catalog = readColumnCatalog(globalConfig);
  const picked = projectConfig?.tasks?.columns;
  if (!Array.isArray(picked) || picked.length === 0) {
    return [...catalog, { id: DONE_COLUMN, label: null }];
  }
  const byId = new Map(catalog.map((c) => [c.id, c]));
  const out = [];
  const seen = new Set();
  for (const raw of picked) {
    const id = String(raw?.id || raw || "").trim().toLowerCase();
    // A project can only pick from the catalog: that is what keeps "QA" the
    // same thing everywhere. An id removed from the catalog quietly disappears
    // from the boards that used it, rather than resurrecting a dead column.
    if (!byId.has(id) || seen.has(id)) continue;
    seen.add(id);
    out.push(byId.get(id));
  }
  if (!out.length) out.push(...catalog);
  return [...out, { id: DONE_COLUMN, label: null }];
}

/**
 * Where a task sits on the board. Closed tasks land in `done` whatever their
 * last open sub-status was; an open task whose status is not a column on THIS
 * board falls into the first one, so a card is never invisible.
 */
export function columnFor(task, columns) {
  if (task?.state !== "open") return DONE_COLUMN;
  const status = task?.status || DEFAULT_TASK_STATUS;
  return columns.some((c) => c.id === status) ? status : (columns[0]?.id || DEFAULT_TASK_STATUS);
}
