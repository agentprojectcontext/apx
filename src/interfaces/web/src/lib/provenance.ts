// Where a conversation COMES FROM — the project its agent belongs to — and
// which of those projects this device wants to see.
//
// A different question from the channel (lib/channels.ts), which says where a
// conversation HAPPENED. Both are true of the same row at once — "Zoya, from
// Appsi, on the web" — so they travel as two badges and never share one slot.
// Sharing it means one of the two facts is always the one missing, which is
// how an open conversation ended up with no way to tell WHOSE Zoya it was:
// the list said "Zoya — Appsi · Web" and the header it opened said "Zoya · web".
//
// The default workspace is deliberately unlabelled. It is the super-agent's
// own, it is where every conversation with no project of its own lands, and
// badging it would mark the majority of rows to say "the usual place". The
// badge is for the rows that come from somewhere ELSE — that is the whole news
// it carries.
//
// The view filter is stored the same way as the channel one and for the same
// reason: per origin, per device, EXPLICIT choices only — so a project
// registered after this was written shows up instead of being silently hidden.
import { t } from "../i18n";

/** The default workspace's id — "Base" in the rail, `/p/0` in the URL. */
export const DEFAULT_PROJECT = "0";

/** What the inbox rows carry of a project. Structural rather than `InboxRow`,
 *  so the phone's placeholder rows and a bare `{ project_id }` both fit. */
export interface HasProject {
  project_id?: number | string | null;
  project_name?: string | null;
}

/**
 * One row's project, as a stable key.
 *
 * A super-agent row carries no project at all (`project_id: null`): it talks
 * across every channel and belongs to the daemon rather than to a workspace.
 * It resolves to the default project — the same answer every surface already
 * reaches for when it OPENS one (`String(row.project_id ?? 0)`), so the filter
 * and the chat pane cannot disagree about where a row lives.
 */
export function projectKeyOf(row: HasProject): string {
  const id = row.project_id;
  return id === null || id === undefined ? DEFAULT_PROJECT : String(id);
}

export function isDefaultProject(id: number | string | null | undefined): boolean {
  return (id === null || id === undefined ? DEFAULT_PROJECT : String(id)) === DEFAULT_PROJECT;
}

/**
 * What to CALL a project on screen.
 *
 * The default one is "Base" in the rail and at `/p/0`, while its name on disk
 * is the bare slug `default` — so it is named here the way the rest of the
 * panel already names it, rather than leaking the slug into the one place a
 * reader meets it as a label.
 */
export function projectLabel(id: number | string | null | undefined, name?: string | null): string {
  if (isDefaultProject(id)) return t("base.title");
  return name || String(id);
}

/** One entry of the project filter: which project, what to call it, how many
 *  conversations it holds right now. */
export interface ProjectOption {
  id: string;
  label: string;
  count: number;
}

/**
 * The projects present in a set of rows, so the filter offers what this install
 * actually has rather than every project ever registered.
 *
 * The default workspace leads, as it does in the rail and in `useProjects`;
 * the rest keep the order they arrived in, which is recency — the project you
 * last talked in sits at the top of the menu.
 */
export function projectsOf(rows: HasProject[]): ProjectOption[] {
  const byId = new Map<string, ProjectOption>();
  for (const row of rows) {
    const id = projectKeyOf(row);
    const hit = byId.get(id);
    if (hit) {
      hit.count += 1;
      // A row that knows the name wins over one that does not: the super-agent
      // and the phone's placeholder rows both carry a null `project_name`.
      if (hit.label === id && row.project_name) hit.label = projectLabel(id, row.project_name);
      continue;
    }
    byId.set(id, { id, label: projectLabel(id, row.project_name), count: 1 });
  }
  const all = [...byId.values()];
  return [
    ...all.filter((p) => isDefaultProject(p.id)),
    ...all.filter((p) => !isDefaultProject(p.id)),
  ];
}

const KEY = "apx.projects.view";

/** The explicit choices. A project absent from here has never been touched and
 *  is shown — a filter must not hide what it was never told to hide. */
export function projectPrefs(): Record<string, boolean> {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    const out: Record<string, boolean> = {};
    for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof v === "boolean") out[k] = v;
    }
    return out;
  } catch {
    return {}; // private mode, or something else wrote over the key
  }
}

/** Should this project's conversations be listed, against a map already in
 *  hand — what a React render has, and what keeps a memo depending on a stable
 *  value instead of a closure rebuilt every render. */
export function projectEnabledIn(prefs: Record<string, boolean>, id: number | string | null | undefined): boolean {
  const explicit = prefs[id === null || id === undefined ? DEFAULT_PROJECT : String(id)];
  return explicit === undefined ? true : explicit;
}

export function setProjectEnabled(id: string, on: boolean) {
  write({ ...projectPrefs(), [id]: on });
}

/** "Show everything again" is one decision, not one per project — and one
 *  write instead of N re-renders. */
export function setProjectsEnabled(ids: string[], on: boolean) {
  const next = { ...projectPrefs() };
  for (const id of ids) next[id] = on;
  write(next);
}

function write(next: Record<string, boolean>) {
  try {
    localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    /* private mode: it holds for this session, which is all we can offer */
  }
  // A same-tab write fires nothing on its own — `storage` only reaches OTHER
  // tabs — so the picker would keep rendering the old answer until something
  // else happened to re-render it.
  try {
    window.dispatchEvent(new CustomEvent(CHANGE_EVENT));
  } catch {
    /* no window (a test): nothing is listening anyway */
  }
}

const CHANGE_EVENT = "apx:project-prefs";

/** Subscribe to changes, from this tab or another one. */
export function onProjectPrefsChange(fn: () => void): () => void {
  const local = () => fn();
  const remote = (e: StorageEvent) => {
    if (!e.key || e.key === KEY) fn();
  };
  window.addEventListener(CHANGE_EVENT, local);
  window.addEventListener("storage", remote);
  return () => {
    window.removeEventListener(CHANGE_EVENT, local);
    window.removeEventListener("storage", remote);
  };
}
