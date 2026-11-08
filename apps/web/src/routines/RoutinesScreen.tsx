import "../styles/screens.css";
import type { Routine } from "@apx/protocol";
import { Button, EmptyState, Icons, ProjectTile, SearchField, SegmentedControl, Select } from "@apx/ui";
import { useEffect, useMemo, useState } from "react";
import { DEFAULT_PID, projectEntries, projectInitial, projectTone } from "../data/identity.ts";
import { draftOf, loadRoutines, type RoutineDraft, useRoutines } from "../data/routines.ts";
import { useData } from "../data/state.ts";
import { useT } from "../i18n/index.ts";
import { RoutineDrawer } from "./RoutineDrawer.tsx";
import { RoutineEditor } from "./RoutineEditor.tsx";
import { type RoutineGroup, RoutineList } from "./RoutineList.tsx";

type State = "all" | "on" | "off";
type Sort = "next" | "last" | "name";

/** Folds accents and case, so "resumen" finds "Resúmen". */
const fold = (s: string) => s.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();

const byNext = (a: Routine, b: Routine) =>
  Number(!a.enabled) - Number(!b.enabled) ||
  (a.next_run_at ?? "~").localeCompare(b.next_run_at ?? "~") ||
  a.name.localeCompare(b.name);
const byLast = (a: Routine, b: Routine) =>
  (b.last?.started_at ?? "").localeCompare(a.last?.started_at ?? "") || a.name.localeCompare(b.name);
const byName = (a: Routine, b: Routine) => a.name.localeCompare(b.name);
const SORTS: Record<Sort, (a: Routine, b: Routine) => number> = { next: byNext, last: byLast, name: byName };

/** Every routine of every project, grouped by project and filtered by what the owner looks for; a row opens its runs. */
export function RoutinesScreen() {
  const t = useT();
  const all = useRoutines((s) => s.routines);
  const ready = useRoutines((s) => s.ready);
  const projects = useData((s) => s.projects);
  const agents = useData((s) => s.agents);
  const [q, setQ] = useState("");
  const [project, setProject] = useState("");
  const [state, setState] = useState<State>("all");
  const [sort, setSort] = useState<Sort>("next");
  const [open, setOpen] = useState<string>();
  const [editing, setEditing] = useState<RoutineDraft>();
  useEffect(() => {
    void loadRoutines();
  }, []);
  const entries = useMemo(() => projectEntries(projects), [projects]);
  const listed = all.filter((r) => r.action !== "relay");
  const groups = useMemo<RoutineGroup[]>(() => {
    const words = fold(q.trim());
    const match = (r: Routine) =>
      (state === "all" || (state === "on" ? r.enabled : !r.enabled)) &&
      (!words || fold(`${r.name} ${agents[r.agent_id]?.name ?? ""}`).includes(words));
    return entries
      .filter((p) => !project || p.id === project)
      .map((p) => ({
        id: p.id,
        title: (
          <>
            <ProjectTile tone={projectTone(p.id)} initial={projectInitial(p.name)} />
            {p.name}
          </>
        ),
        routines: listed
          .filter((r) => (p.id === DEFAULT_PID ? !r.project_id : r.project_id === p.id) && match(r))
          .sort(SORTS[sort]),
      }))
      .filter((g) => g.routines.length > 0);
  }, [entries, listed, project, state, sort, q, agents]);
  const current = listed.find((r) => r.id === open);
  const blank: RoutineDraft = {
    name: "",
    agent: "",
    ...(project && project !== DEFAULT_PID ? { project } : {}),
    schedule: { kind: "cron", cron: "0 9 * * *" },
    action: "agent",
    prompt: "",
    pre_command: "",
    post_command: "",
    call_model: "always",
    anchor: false,
    max_steps: "",
    enabled: true,
  };
  return (
    <section className="page page--routines" aria-label={t("nav.routines")}>
      <header className="page__head page__head--row">
        <div>
          <h1 className="page__title">{t("nav.routines")}</h1>
          <p className="page__lead">{t("routines.allLead")}</p>
        </div>
        <Button leadingIcon={<Icons.Plus size={14} />} onClick={() => setEditing(blank)}>
          {t("routines.new")}
        </Button>
      </header>
      <div className="routines">
        {ready && listed.length === 0 ? (
          <EmptyState variant="dashed" size="lg" icon={<Icons.Clock />} title={t("routines.emptyTitle")}>
            {t("routines.empty")}
          </EmptyState>
        ) : (
          <>
            <div className="rtfilters">
              <SearchField
                size="sm"
                value={q}
                placeholder={t("routines.search")}
                aria-label={t("routines.search")}
                onChange={(e) => setQ(e.currentTarget.value)}
              />
              <Select
                size="sm"
                label={t("routines.filterProject")}
                value={project}
                onValueChange={(v) => setProject(v ?? "")}
                options={[
                  { value: "", label: t("routines.allProjects") },
                  ...entries.map((p) => ({ value: p.id, label: p.name })),
                ]}
              />
              <SegmentedControl
                size="sm"
                label={t("routines.filterState")}
                value={state}
                onValueChange={(v) => setState(v === "on" || v === "off" ? v : "all")}
                options={[
                  { value: "all", label: t("routines.state.all") },
                  { value: "on", label: t("routines.state.on") },
                  { value: "off", label: t("routines.state.off") },
                ]}
              />
              <Select
                size="sm"
                label={t("routines.sort")}
                value={sort}
                onValueChange={(v) => setSort(v === "last" || v === "name" ? v : "next")}
                options={[
                  { value: "next", label: t("routines.sort.next") },
                  { value: "last", label: t("routines.sort.last") },
                  { value: "name", label: t("routines.sort.name") },
                ]}
              />
            </div>
            {groups.length === 0 ? (
              <EmptyState size="sm" icon={<Icons.Search />} title={t("routines.noMatch")} />
            ) : (
              <RoutineList
                groups={groups}
                open={open}
                onOpen={(id) => setOpen(open === id ? undefined : id)}
                onEdit={(r) => setEditing(draftOf(r))}
              />
            )}
          </>
        )}
      </div>
      {current && (
        <RoutineDrawer
          key={current.id}
          routine={current}
          agentName={agents[current.agent_id]?.name ?? current.agent_id}
          onEdit={() => setEditing(draftOf(current))}
          onClose={() => setOpen(undefined)}
        />
      )}
      {editing && <RoutineEditor draft={editing} onClose={() => setEditing(undefined)} />}
    </section>
  );
}
