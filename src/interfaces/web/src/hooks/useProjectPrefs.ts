import { useEffect, useState } from "react";
import {
  projectEnabledIn,
  projectPrefs,
  setProjectEnabled,
  setProjectsEnabled,
  onProjectPrefsChange,
} from "../lib/provenance";

/**
 * React binding for this device's per-project view filter (lib/provenance.ts).
 *
 * The same shape as `useChannelPrefs`, one axis instead of two: a project is
 * somewhere conversations come FROM, not somewhere a notification can arrive
 * from, so there is nothing for a `notify` axis to decide.
 *
 * Kept in state rather than read from localStorage per render so a change here
 * and one in another tab both repaint, and so React has something to re-render
 * on.
 */
export function useProjectPrefs() {
  const [prefs, setPrefs] = useState<Record<string, boolean>>(() => projectPrefs());

  useEffect(() => onProjectPrefsChange(() => setPrefs(projectPrefs())), []);

  const enabled = (id: number | string | null | undefined): boolean =>
    projectEnabledIn(prefs, id);

  return {
    /** The stored map itself, so a caller can memoise against it. */
    prefs,
    enabled,
    toggle: (id: string) => setProjectEnabled(id, !enabled(id)),
    setAll: (ids: string[], on: boolean) => setProjectsEnabled(ids, on),
  };
}
